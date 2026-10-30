import { z } from "zod";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { IMAGE_RULES } from "@contracts/constants";
import { MAX_PAYMENT_AMOUNT, MAX_PENDING_PAYMENTS, MIN_PAYMENT_REFERENCE_LENGTH, normalizePaymentReference } from "@contracts/wallet";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { businesses, financeSettings, settlements, users, walletEntries, type User } from "@db/schema";
import { walletSummary, type WalletType } from "./lib/wallet";
import { assertValidImageUrl, createImageUploadUrl, paymentProofFolder, promoteStagedImageUrl, type SupportedImageMime } from "./lib/image-storage";
import { sendPushToUsers } from "./lib/push-notifications";

/** Cuenta de quien consulta: el repartidor la suya y el dueño de un comercio la de su local. */
async function myWallet(user: Pick<User, "id" | "appRole">): Promise<{ walletType: WalletType; walletId: number; displayName?: string } | null> {
  if (user.appRole === "courier") return { walletType: "courier", walletId: user.id };
  if (user.appRole === "business") {
    const [biz] = await getDb().select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.ownerId, user.id)).limit(1);
    return biz ? { walletType: "business", walletId: biz.id, displayName: biz.name } : null;
  }
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const walletRouter = createRouter({
  /** Estado de cuenta de quien consulta. */
  mine: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const wallet = await myWallet(ctx.user);
    if (!wallet) return null;
    const { walletType, walletId } = wallet;
    const summary = await walletSummary(walletType, walletId);
    // Solo columnas útiles para la persona: nada de quién lo creó o revisó, ni la URL del comprobante.
    const entries = await db
      .select({
        id: walletEntries.id,
        entryType: walletEntries.entryType,
        amount: walletEntries.amount,
        status: walletEntries.status,
        description: walletEntries.description,
        paymentReference: walletEntries.paymentReference,
        reviewNote: walletEntries.reviewNote,
        hasProof: sql<number>`(${walletEntries.proofUrl} is not null)`,
        orderId: walletEntries.orderId,
        createdAt: walletEntries.createdAt,
      })
      .from(walletEntries)
      .where(and(eq(walletEntries.walletType, walletType), eq(walletEntries.walletId, walletId)))
      .orderBy(desc(walletEntries.createdAt), desc(walletEntries.id))
      .limit(30);
    const [settings] = await db.select({ paymentInstructions: financeSettings.paymentInstructions }).from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
    return {
      walletType,
      ...summary,
      paymentInstructions: settings?.paymentInstructions ?? null,
      maxPendingPayments: MAX_PENDING_PAYMENTS,
      entries: entries.map((e) => ({ ...e, hasProof: Boolean(Number(e.hasProof)) })),
    };
  }),

  /** URL prefirmada para subir la foto del comprobante (misma mecánica que las demás imágenes: va a staging/). */
  createProofUpload: authedQuery
    .input(z.object({ contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().int().min(1).max(IMAGE_RULES.maxBytes) }))
    .mutation(async ({ ctx, input }) => {
      const wallet = await myWallet(ctx.user);
      if (!wallet) throw new TRPCError({ code: "FORBIDDEN", message: "Solo repartidores y comercios tienen estado de cuenta." });
      return createImageUploadUrl({
        kind: "payment-proof",
        folder: paymentProofFolder(wallet.walletType, wallet.walletId),
        contentType: input.contentType as SupportedImageMime,
        size: input.size,
        userId: ctx.user.id,
      });
    }),

  /**
   * La persona reporta un pago con su referencia y la foto del comprobante. Queda "por verificar": no reduce el
   * saldo hasta que el admin lo confirme.
   */
  reportPayment: authedQuery
    .input(z.object({
      amount: z.number().positive().max(MAX_PAYMENT_AMOUNT),
      paymentReference: z.string().trim().min(MIN_PAYMENT_REFERENCE_LENGTH, `Escribe la referencia del pago (mínimo ${MIN_PAYMENT_REFERENCE_LENGTH} caracteres)`).max(120),
      proofUrl: z.string().url().max(1000),
      note: z.string().trim().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const wallet = await myWallet(ctx.user);
      if (!wallet) throw new TRPCError({ code: "FORBIDDEN", message: "Solo repartidores y comercios pueden reportar pagos." });
      const { walletType, walletId } = wallet;
      const reference = normalizePaymentReference(input.paymentReference);
      const amount = round2(input.amount);
      if (!(amount > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Ingresa un importe válido." });

      const [pending] = await db.select({ n: count() }).from(walletEntries).where(and(
        eq(walletEntries.walletType, walletType), eq(walletEntries.walletId, walletId),
        eq(walletEntries.entryType, "payment"), eq(walletEntries.status, "pending"),
      ));
      if ((pending?.n ?? 0) >= MAX_PENDING_PAYMENTS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Ya tienes ${MAX_PENDING_PAYMENTS} pagos por verificar. Espera a que administración los revise.` });
      }
      // Una misma referencia (o un mismo comprobante) no puede registrarse dos veces, ni en otra cuenta.
      const [sameReference] = await db.select({ id: walletEntries.id }).from(walletEntries).where(and(
        eq(walletEntries.entryType, "payment"), inArray(walletEntries.status, ["pending", "confirmed"]),
        sql`upper(${walletEntries.paymentReference}) = ${reference.toUpperCase()}`,
      )).limit(1);
      if (sameReference) throw new TRPCError({ code: "BAD_REQUEST", message: "Esa referencia de pago ya fue registrada." });
      const [sameProof] = await db.select({ id: walletEntries.id }).from(walletEntries).where(eq(walletEntries.proofUrl, input.proofUrl)).limit(1);
      if (sameProof) throw new TRPCError({ code: "BAD_REQUEST", message: "Ese comprobante ya fue usado. Sube la foto de este pago." });

      // Confirma la subida temporal y valida que la foto sea de ESTA cuenta (no una URL ajena).
      const folder = paymentProofFolder(walletType, walletId);
      const proofUrl = await promoteStagedImageUrl(input.proofUrl, folder);
      assertValidImageUrl(proofUrl, folder);

      await db.insert(walletEntries).values({
        walletType,
        walletId,
        entryType: "payment",
        status: "pending",
        amount,
        description: `Pago reportado${input.note ? `: ${input.note}` : ""}`.slice(0, 300),
        paymentReference: reference,
        proofUrl: proofUrl ?? null,
        createdBy: ctx.user.id,
      });

      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
      const who = wallet.displayName ?? ctx.user.name ?? (walletType === "courier" ? "Un repartidor" : "Un comercio");
      await sendPushToUsers(admins.map((a) => a.id), {
        title: "Pago por verificar 💵",
        body: `${who} reportó $${amount.toFixed(2)} (ref. ${reference}).`,
        url: "/admin",
      }).catch((error) => console.error("[wallet] No se pudo avisar a administración:", error));
      return { ok: true };
    }),

  /** Liquidaciones (estados de cuenta por período) que administración generó para esta cuenta. */
  mySettlements: authedQuery.query(async ({ ctx }) => {
    const wallet = await myWallet(ctx.user);
    if (!wallet) return [];
    return getDb()
      .select({
        id: settlements.id,
        periodStart: settlements.periodStart,
        periodEnd: settlements.periodEnd,
        openingBalance: settlements.openingBalance,
        charges: settlements.charges,
        payments: settlements.payments,
        adjustments: settlements.adjustments,
        closingBalance: settlements.closingBalance,
      })
      .from(settlements)
      .where(and(eq(settlements.walletType, wallet.walletType), eq(settlements.walletId, wallet.walletId)))
      .orderBy(desc(settlements.periodEnd), desc(settlements.id))
      .limit(24);
  }),
});
