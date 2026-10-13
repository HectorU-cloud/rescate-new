import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { createImageUploadUrl, type SupportedImageMime } from "./lib/image-storage";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { sendPushToUser } from "./lib/push-notifications";

export const profileRouter = createRouter({
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
    .input(z.object({ contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN", message: "Selecciona primero el modo repartidor." });
      return createImageUploadUrl({ ownerId: ctx.user.id, contentType: input.contentType as SupportedImageMime, kind: "courier-profile" });
    }),
  updateCourierProfile: authedQuery
    .input(z.object({ photoUrl: z.string().url().max(1000).optional(), vehicle: z.string().trim().max(80).optional(), plate: z.string().trim().max(20).optional(), bio: z.string().trim().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN", message: "Selecciona primero el modo repartidor." });
      if (input.photoUrl && !input.photoUrl.startsWith("https://")) throw new TRPCError({ code: "BAD_REQUEST", message: "La foto debe usar HTTPS." });
      const db = getDb();
      const [current] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
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
