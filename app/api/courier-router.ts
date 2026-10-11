import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { notifyOrderStatus } from "./lib/push-notifications";
import { businesses, courierLocations, orderItems, orders } from "@db/schema";

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
        where: and(eq(orders.id, input.orderId), eq(orders.courierId, ctx.user.id), eq(orders.status, "picked_up"), eq(orders.type, "delivery")),
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
      await db
        .update(orders)
        .set({ courierId: ctx.user.id, status: "picked_up" })
        .where(and(eq(orders.id, order.id), eq(orders.status, "ready"), isNull(orders.courierId)));
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "picked_up", type: order.type });
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

  markDelivered: authedQuery
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: and(
          eq(orders.id, input.orderId),
          eq(orders.courierId, ctx.user.id),
          eq(orders.status, "picked_up"),
        ),
      });
      if (!order) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes entregar este pedido" });
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
      .where(and(eq(orders.courierId, ctx.user.id), eq(orders.status, "picked_up")));
    return {
      deliveries: Number(row?.deliveries ?? 0),
      earnings: Number(row?.earnings ?? 0),
      active: Number(activeRow?.count ?? 0),
    };
  }),
});
