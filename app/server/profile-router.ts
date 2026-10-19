import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { assertValidImageUrl, courierPhotoFolder, createImageUploadUrl, type SupportedImageMime } from "./lib/image-storage";
import { releaseReplacedImage } from "./lib/image-cleanup";
import { IMAGE_RULES } from "@contracts/constants";
import { getDb } from "./queries/connection";
import { customerAddresses, users } from "@db/schema";
import { sendPushToUser } from "./lib/push-notifications";

export const profileRouter = createRouter({
  // Las direcciones son privadas y siempre se consultan por el usuario autenticado.
  myAddresses: authedQuery.query(async ({ ctx }) =>
    getDb().select().from(customerAddresses).where(eq(customerAddresses.userId, ctx.user.id))
      .orderBy(desc(customerAddresses.isDefault), desc(customerAddresses.id)), // la principal primero, luego las más nuevas
  ),
  saveAddress: authedQuery
    .input(z.object({ label: z.string().trim().min(1).max(60), address: z.string().trim().min(5).max(300), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), isDefault: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      await getDb().transaction(async (tx) => {
        // Se bloquea la fila del usuario: dos guardados simultáneos no pueden superar el límite
        // ni dejar dos direcciones principales.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, ctx.user.id)).for("update");
        const existing = await tx.select({ id: customerAddresses.id }).from(customerAddresses).where(eq(customerAddresses.userId, ctx.user.id));
        if (existing.length >= 10) throw new TRPCError({ code: "BAD_REQUEST", message: "Puedes guardar hasta 10 direcciones." });
        const makeDefault = input.isDefault || existing.length === 0;
        if (makeDefault) await tx.update(customerAddresses).set({ isDefault: false }).where(eq(customerAddresses.userId, ctx.user.id));
        await tx.insert(customerAddresses).values({ userId: ctx.user.id, label: input.label, address: input.address, lat: input.lat, lng: input.lng, isDefault: makeDefault });
      });
      return { ok: true };
    }),
  deleteAddress: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await getDb().transaction(async (tx) => {
        const [target] = await tx.select().from(customerAddresses).where(and(eq(customerAddresses.id, input.id), eq(customerAddresses.userId, ctx.user.id))).limit(1);
        if (!target) return; // no existe o es de otra persona: no se borra nada
        await tx.delete(customerAddresses).where(and(eq(customerAddresses.id, target.id), eq(customerAddresses.userId, ctx.user.id)));
        // Si era la principal, la más reciente de las que quedan pasa a serlo.
        if (target.isDefault) {
          const [next] = await tx.select({ id: customerAddresses.id }).from(customerAddresses).where(eq(customerAddresses.userId, ctx.user.id)).orderBy(desc(customerAddresses.id)).limit(1);
          if (next) await tx.update(customerAddresses).set({ isDefault: true }).where(eq(customerAddresses.id, next.id));
        }
      });
      return { ok: true };
    }),

  courierProfile: authedQuery.query(async ({ ctx }) => {
    const [user] = await getDb().select({
      id: users.id, name: users.name, email: users.email, avatar: users.avatar,
      courierPhotoUrl: users.courierPhotoUrl, courierVehicle: users.courierVehicle,
      courierPlate: users.courierPlate, courierBio: users.courierBio,
      courierApproved: users.courierApproved,
      courierVerification: users.courierVerification, courierReviewNote: users.courierReviewNote,
      courierAvailable: users.courierAvailable,
    }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return user ?? null;
  }),
  createCourierPhotoUpload: authedQuery
    .input(z.object({ contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().int().min(1).max(IMAGE_RULES.maxBytes) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN", message: "Selecciona primero el modo repartidor." });
      return createImageUploadUrl({ ownerId: ctx.user.id, userId: ctx.user.id, contentType: input.contentType as SupportedImageMime, size: input.size, kind: "courier-profile" });
    }),
  updateCourierProfile: authedQuery
    .input(z.object({ photoUrl: z.string().url().max(1000).optional(), vehicle: z.string().trim().max(80).optional(), plate: z.string().trim().max(20).optional(), bio: z.string().trim().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN", message: "Selecciona primero el modo repartidor." });
      const db = getDb();
      const [current] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      // La foto debe ser una que ESTE repartidor subió a su carpeta (no una URL de terceros)
      assertValidImageUrl(input.photoUrl, courierPhotoFolder(ctx.user.id), current?.courierPhotoUrl);
      // Si cambia foto, vehículo o placa, el perfil debe revisarse de nuevo.
      const sensitiveChange =
        (input.photoUrl !== undefined && input.photoUrl !== current?.courierPhotoUrl) ||
        (input.vehicle !== undefined && input.vehicle !== current?.courierVehicle) ||
        (input.plate !== undefined && input.plate !== current?.courierPlate);
      await db.update(users).set({
        courierPhotoUrl: input.photoUrl, courierVehicle: input.vehicle, courierPlate: input.plate, courierBio: input.bio,
        ...(sensitiveChange || current?.courierVerification === "rejected"
          ? { courierVerification: "pending" as const, courierApproved: false, courierReviewNote: null }
          : {}),
      }).where(eq(users.id, ctx.user.id));
      // Si cambió la foto, borra la anterior del almacenamiento
      if (input.photoUrl !== undefined) await releaseReplacedImage(current?.courierPhotoUrl, input.photoUrl, courierPhotoFolder(ctx.user.id));
      return { ok: true, backToReview: sensitiveChange };
    }),
  adminCouriers: adminQuery.query(async () => getDb().select({ id: users.id, name: users.name, email: users.email, courierPhotoUrl: users.courierPhotoUrl, courierVehicle: users.courierVehicle, courierPlate: users.courierPlate, courierBio: users.courierBio, courierApproved: users.courierApproved, courierRating: users.courierRating, courierRatingCount: users.courierRatingCount }).from(users).where(eq(users.appRole, "courier"))),
  // Perfiles de repartidor enviados a revisión (los usa AdminCourierReview).
  pendingCouriers: adminQuery.query(async () =>
    getDb().select({
      id: users.id, name: users.name, email: users.email, phone: users.phone,
      photoUrl: users.courierPhotoUrl, vehicle: users.courierVehicle,
      plate: users.courierPlate, bio: users.courierBio,
    }).from(users).where(and(
      eq(users.appRole, "courier"),
      eq(users.courierVerification, "pending"),
      eq(users.courierApproved, false),
      isNotNull(users.courierVehicle), // solo quienes ya completaron su perfil
    )),
  ),
  reviewCourierVerification: adminQuery
    .input(z.object({
      userId: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().trim().max(300).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [target] = await db.select({ id: users.id, appRole: users.appRole }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target || target.appRole !== "courier") throw new TRPCError({ code: "NOT_FOUND", message: "Repartidor no encontrado." });
      const approved = input.decision === "approved";
      if (!approved && !input.note) throw new TRPCError({ code: "BAD_REQUEST", message: "Indica el motivo para que el repartidor sepa qué corregir." });
      await db.update(users).set({
        courierApproved: approved,
        courierVerification: input.decision,
        courierReviewNote: approved ? null : input.note!,
      }).where(eq(users.id, input.userId));
      await sendPushToUser(input.userId, approved
        ? { title: "Perfil aprobado ✅", body: "Ya puedes recibir y tomar entregas.", url: "/repartidor" }
        : { title: "Tu perfil necesita cambios", body: input.note!, url: "/perfil" },
      ).catch((error) => console.error("Error avisando revisión al repartidor:", error));
      return { ok: true };
    }),
  setCourierApproval: adminQuery
    .input(z.object({ userId: z.number().int().positive(), approved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id && !input.approved) throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes retirar tu propia aprobación desde esta pantalla." });
      await getDb().update(users).set({ courierApproved: input.approved, courierVerification: input.approved ? "approved" : "pending", courierReviewNote: null }).where(eq(users.id, input.userId));
      return { ok: true };
    }),
  setAppRole: authedQuery
    .input(z.object({ appRole: z.enum(["customer", "business", "courier"]) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(users)
        .set({ appRole: input.appRole })
        .where(eq(users.id, ctx.user.id));
      return { ok: true };
    }),

  updatePhone: authedQuery
    .input(z.object({ phone: z.string().min(6).max(30) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(users)
        .set({ phone: input.phone })
        .where(eq(users.id, ctx.user.id));
      return { ok: true };
    }),
});
