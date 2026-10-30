import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { businesses, financeSettings, walletEntries, type WalletEntry } from "@db/schema";
import { computeBalance, computePendingPayments, debtState, type DebtState } from "@contracts/wallet";
import { getDb } from "../queries/connection";
import { sendPushToUser } from "./push-notifications";

export type WalletType = "courier" | "business";

/** Límites vigentes (solo lectura: si el admin aún no guardó configuración, se usan los valores por defecto). */
export async function getDebtLimits() {
  const [row] = await getDb().select({ courier: financeSettings.courierDebtLimit, business: financeSettings.businessDebtLimit }).from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
  return { courier: row?.courier ?? 5, business: row?.business ?? 15 };
}

export type WalletSummary = { balance: number; pendingPayments: number; limit: number; state: DebtState };

export async function walletSummary(walletType: WalletType, walletId: number): Promise<WalletSummary> {
  const rows = await getDb()
    .select({ entryType: walletEntries.entryType, amount: walletEntries.amount, status: walletEntries.status })
    .from(walletEntries)
    .where(and(eq(walletEntries.walletType, walletType), eq(walletEntries.walletId, walletId)));
  const limit = (await getDebtLimits())[walletType];
  const balance = computeBalance(rows);
  return { balance, pendingPayments: computePendingPayments(rows), limit, state: debtState(balance, limit) };
}

/** Impide tomar o aceptar pedidos nuevos mientras la deuda supere el límite que configuró el admin. */
export async function assertWalletNotBlocked(walletType: WalletType, walletId: number): Promise<void> {
  const w = await walletSummary(walletType, walletId);
  if (w.state !== "blocked") return;
  const money = (n: number) => `$${n.toFixed(2)}`;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Tu saldo pendiente con Rescate (${money(w.balance)}) supera el límite de ${money(w.limit)}. ${
      walletType === "courier" ? "Paga tu saldo para volver a tomar pedidos." : "Paga tu saldo para volver a aceptar pedidos."
    }${w.pendingPayments > 0 ? ` Tienes ${money(w.pendingPayments)} en pagos por verificar.` : ""}`,
  });
}

/** Usuario que recibe los avisos de una cuenta: el repartidor mismo, o el dueño del comercio. */
export async function walletOwnerUserId(walletType: WalletType, walletId: number): Promise<number | null> {
  if (walletType === "courier") return walletId;
  const [biz] = await getDb().select({ ownerId: businesses.ownerId }).from(businesses).where(eq(businesses.id, walletId)).limit(1);
  return biz?.ownerId ?? null;
}

/** Avisa a la persona (push + campana) que su pago fue confirmado o rechazado. Nunca lanza error. */
export async function notifyPaymentReview(entry: Pick<WalletEntry, "walletType" | "walletId" | "amount" | "paymentReference">, decision: "confirmed" | "rejected", note?: string | null) {
  try {
    const userId = await walletOwnerUserId(entry.walletType, entry.walletId);
    if (!userId) return;
    const money = (n: number) => `$${n.toFixed(2)}`;
    const ref = entry.paymentReference ? ` (ref. ${entry.paymentReference})` : "";
    const url = entry.walletType === "courier" ? "/repartidor" : "/panel";
    if (decision === "confirmed") {
      const w = await walletSummary(entry.walletType, entry.walletId);
      await sendPushToUser(userId, {
        title: "Pago confirmado ✅",
        body: `Confirmamos tu pago de ${money(entry.amount)}${ref}. ${w.balance > 0 ? `Tu saldo pendiente es ${money(w.balance)}.` : "Estás al día."}`,
        url,
      });
    } else {
      await sendPushToUser(userId, {
        title: "Pago rechazado",
        body: `No pudimos verificar tu pago de ${money(entry.amount)}${ref}.${note ? ` Motivo: ${note}` : ""}`,
        url,
      });
    }
  } catch (error) {
    console.error("[wallet] No se pudo avisar la revisión del pago:", error);
  }
}
