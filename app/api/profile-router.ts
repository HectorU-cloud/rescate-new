import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { adminQuery } from "./middleware";
import { TRPCError } from "@trpc/server";

export const profileRouter = createRouter({
  updateCourierProfile: authedQuery
    .input(z.object({
      name: z.string().min(2).max(255),
      photoUrl: z.string().url().refine((value) => value.startsWith("https://"), "La foto debe usar una URL HTTPS").max(2000).optional(),
      vehicle: z.string().min(2).max(80),
      plate: z.string().max(20).optional(),
      bio: z.string().max(240).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN", message: "Solo los repartidores pueden editar este perfil" });
      await getDb().update(users).set({
        name: input.name.trim(), courierPhotoUrl: input.photoUrl?.trim() || null,
        courierVehicle: input.vehicle.trim(), courierPlate: input.plate?.trim() || null,
        courierBio: input.bio?.trim() || null, courierVerificationStatus: "pending", courierVerificationNote: null,
      }).where(eq(users.id, ctx.user.id));
      return { ok: true, verificationStatus: "pending" as const };
    }),

  pendingCouriers: adminQuery.query(async () => {
    const rows = await getDb().select({ id: users.id, name: users.name, email: users.email, phone: users.phone, photoUrl: users.courierPhotoUrl, vehicle: users.courierVehicle, plate: users.courierPlate, bio: users.courierBio, status: users.courierVerificationStatus, note: users.courierVerificationNote, createdAt: users.createdAt }).from(users).where(eq(users.courierVerificationStatus, "pending")).orderBy(desc(users.createdAt));
    return rows;
  }),

  reviewCourierVerification: adminQuery
    .input(z.object({ userId: z.number().int().positive(), decision: z.enum(["approved", "rejected"]), note: z.string().max(300).optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const courier = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!courier || courier.appRole !== "courier") throw new TRPCError({ code: "NOT_FOUND", message: "No se encontró el perfil de repartidor" });
      await db.update(users).set({ courierVerificationStatus: input.decision, courierVerificationNote: input.note?.trim() || null }).where(eq(users.id, input.userId));
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
