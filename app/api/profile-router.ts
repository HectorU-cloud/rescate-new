import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { createImageUploadUrl, type SupportedImageMime } from "./lib/image-storage";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";

export const profileRouter = createRouter({
  courierProfile: authedQuery.query(async ({ ctx }) => {
    const [user] = await getDb().select({
      id: users.id, name: users.name, email: users.email, avatar: users.avatar,
      courierPhotoUrl: users.courierPhotoUrl, courierVehicle: users.courierVehicle,
      courierPlate: users.courierPlate, courierBio: users.courierBio,
      courierApproved: users.courierApproved,
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
      await getDb().update(users).set({ courierPhotoUrl: input.photoUrl, courierVehicle: input.vehicle, courierPlate: input.plate, courierBio: input.bio }).where(eq(users.id, ctx.user.id));
      return { ok: true };
    }),
  adminCouriers: adminQuery.query(async () => getDb().select({ id: users.id, name: users.name, email: users.email, courierPhotoUrl: users.courierPhotoUrl, courierVehicle: users.courierVehicle, courierPlate: users.courierPlate, courierBio: users.courierBio, courierApproved: users.courierApproved }).from(users).where(eq(users.appRole, "courier"))),
  setCourierApproval: adminQuery
    .input(z.object({ userId: z.number().int().positive(), approved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id && !input.approved) throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes retirar tu propia aprobación desde esta pantalla." });
      await getDb().update(users).set({ courierApproved: input.approved }).where(eq(users.id, input.userId));
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
