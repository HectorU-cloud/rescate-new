import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { notifyOrderStatus } from "./lib/push-notifications";
import { businesses, courierLocations, courierReviews, orderItems, orders, users } from "@db/schema";

export const courierRouter = createRouter({
  // El navegador/app del repartidor envía su posición mientras una entrega está activa.
  updateLocation: authedQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(100000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo un repartidor puede compartir ubicación" });
      }
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, input.orderId), eq(orders.courierId, ctx.user.id), inArray(orders.status, ["assigned", "arrived", "picked_up"]), eq(orders.type, "delivery")),
      });
      if (!order) throw new TRPCError({ code: "FORBIDDEN", message: "No tienes una entrega activa para este pedido" });
      await db.insert(courierLocations).values({
        orderId: order.id, courierId: ctx.user.id, lat: input.lat, lng: input.lng,
        accuracy: input.accuracy ?? null, updatedAt: new Date(),
      }).onDuplicateKeyUpdate({ set: {
        courierId: ctx.user.id, lat: input.lat, lng: input.lng,
        accuracy: input.accuracy ?? null, updatedAt: new Date(),
      }});
      return { ok: true };
    }),
  // Pedidos listos que aún no tienen repartidor
  available: authedQuery.query(async ({ ctx }) => {
    if (ctx.user.appRole !== "courier") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Regístrate como repartidor" });
    }
    const db = getDb();
    const courier = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
    if (courier?.courierVerificationStatus !== "approved") return [];
    const rows = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.type, "delivery"),
          eq(orders.status, "ready"),
          isNull(orders.courierId),
        ),
      )
      .orderBy(desc(orders.createdAt));
    const bizRows = await db.select().from(businesses);
    const byId = new Map(bizRows.map((b) => [b.id, b]));
    return rows.map((o) => ({ order: o, business: byId.get(o.businessId) ?? null }));
  }),

  accept: authedQuery
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Regístrate como repartidor" });
      }
      const db = getDb();
      const courier = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
      if (courier?.courierVerificationStatus !== "approved") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Tu perfil de repartidor debe ser aprobado por Rescate antes de tomar pedidos" });
      }
      const order = await db.query.orders.findFirst({
        where: and(
          eq(orders.id, input.orderId),
          eq(orders.type, "delivery"),
          eq(orders.status, "ready"),
          isNull(orders.courierId),
        ),
      });
      if (!order) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido ya fue tomado" });
      }
      const result = await db
        .update(orders)
        .set({ courierId: ctx.user.id, status: "assigned" })
        .where(and(eq(orders.id, order.id), eq(orders.status, "ready"), isNull(orders.courierId)));
      if (Number((result as any)[0]?.affectedRows ?? (result as any).affectedRows ?? 0) === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Otro repartidor acaba de tomar este pedido. Actualiza la lista." });
      }
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "assigned", type: order.type });
      return { ok: true };
    }),

  myDeliveries: authedQuery.query(async ({ ctx }) => {
    if (ctx.user.appRole !== "courier") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Regístrate como repartidor" });
    }
    const db = getDb();
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.courierId, ctx.user.id))
      .orderBy(desc(orders.createdAt));
    const bizRows = await db.select().from(businesses);
    const byId = new Map(bizRows.map((b) => [b.id, b]));
    const ids = rows.map((o) => o.id);
    const items =
      ids.length > 0
        ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids))
        : [];
    const byOrder = new Map<number, typeof items>();
    for (const it of items) {
      const arr = byOrder.get(it.orderId) ?? [];
      arr.push(it);
      byOrder.set(it.orderId, arr);
    }
    return rows.map((o) => ({
      order: o,
      business: byId.get(o.businessId) ?? null,
      items: byOrder.get(o.id) ?? [],
    }));
  }),

  markArrived: authedQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN" });
      const db = getDb();
      const order = await db.query.orders.findFirst({ where: and(eq(orders.id, input.orderId), eq(orders.courierId, ctx.user.id), eq(orders.status, "assigned"), eq(orders.type, "delivery")) });
      if (!order) throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido no está asignado o ya cambió de estado" });
      await db.update(orders).set({ status: "arrived" }).where(and(eq(orders.id, order.id), eq(orders.courierId, ctx.user.id), eq(orders.status, "assigned")));
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "arrived", type: order.type });
      return { ok: true };
    }),

  markPickedUp: authedQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN" });
      const db = getDb();
      const order = await db.query.orders.findFirst({ where: and(eq(orders.id, input.orderId), eq(orders.courierId, ctx.user.id), inArray(orders.status, ["assigned", "arrived"]), eq(orders.type, "delivery")) });
      if (!order) throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido no está listo para marcar como recogido" });
      await db.update(orders).set({ status: "picked_up" }).where(and(eq(orders.id, order.id), eq(orders.courierId, ctx.user.id), inArray(orders.status, ["assigned", "arrived"])));
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "picked_up", type: order.type });
      return { ok: true };
    }),

  profile: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const courier = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
    if (!courier || courier.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN" });
    const [deliveryStats] = await db.select({ deliveries: sql<number>`count(*)` }).from(orders).where(and(eq(orders.courierId, ctx.user.id), eq(orders.status, "delivered"), eq(orders.type, "delivery")));
    const [reviewStats] = await db.select({ rating: sql<number>`coalesce(avg(${courierReviews.rating}), 0)`, reviewCount: sql<number>`count(*)` }).from(courierReviews).where(eq(courierReviews.courierId, ctx.user.id));
    return { id: courier.id, name: courier.name, photoUrl: courier.courierPhotoUrl ?? courier.avatar, vehicle: courier.courierVehicle, plate: courier.courierPlate, bio: courier.courierBio, verificationStatus: courier.courierVerificationStatus, verificationNote: courier.courierVerificationNote, deliveries: Number(deliveryStats?.deliveries ?? 0), rating: Number(reviewStats?.rating ?? 0), reviewCount: Number(reviewStats?.reviewCount ?? 0) };
  }),

  reviewCourier: authedQuery
    .input(z.object({ orderId: z.number().int().positive(), rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({ where: and(eq(orders.id, input.orderId), eq(orders.customerId, ctx.user.id), eq(orders.status, "delivered"), eq(orders.type, "delivery")) });
      if (!order?.courierId) throw new TRPCError({ code: "BAD_REQUEST", message: "Solo puedes valorar una entrega completada" });
      const existing = await db.query.courierReviews.findFirst({ where: eq(courierReviews.orderId, order.id) });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Ya valoraste esta entrega" });
      await db.insert(courierReviews).values({ orderId: order.id, courierId: order.courierId, customerId: ctx.user.id, rating: input.rating, comment: input.comment?.trim() || null });
      return { ok: true };
    }),

  markDelivered: authedQuery
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: and(
          eq(orders.id, input.orderId),
          eq(orders.courierId, ctx.user.id),
          eq(orders.status, "picked_up"),
          eq(orders.type, "delivery"),
        ),
      });
      if (!order) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Primero debes marcar el pedido como recogido" });
      }
      await db.update(orders).set({ status: "delivered" }).where(eq(orders.id, order.id));
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "delivered", type: order.type });
      // Eliminar la posición al cerrar la entrega para no conservar datos de ubicación innecesarios.
      await db.delete(courierLocations).where(eq(courierLocations.orderId, order.id));
      return { ok: true };
    }),

  earnings: authedQuery.query(async ({ ctx }) => {
    if (ctx.user.appRole !== "courier") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Regístrate como repartidor" });
    }
    const db = getDb();
    const [row] = await db
      .select({
        deliveries: sql<number>`count(*)`,
        earnings: sql<number>`coalesce(sum(deliveryFee), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.courierId, ctx.user.id), eq(orders.status, "delivered")));
    const [activeRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.courierId, ctx.user.id), inArray(orders.status, ["assigned", "arrived", "picked_up"])));
    return {
      deliveries: Number(row?.deliveries ?? 0),
      earnings: Number(row?.earnings ?? 0),
      active: Number(activeRow?.count ?? 0),
    };
  }),
});
