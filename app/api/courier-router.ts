import { z } from "zod";
import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { notifyCouriersOrderReady, notifyOrderStatus, sendPushToUser } from "./lib/push-notifications";
import { logOrderEvent } from "./lib/order-events";
import { BUSINESS_RULES } from "@contracts/constants";
import { businesses, courierLocations, orderItems, orders, users } from "@db/schema";

const MAX_ACTIVE_DELIVERIES = 2;

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
      const courier = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
      if (!courier?.courierApproved) throw new TRPCError({ code: "FORBIDDEN", message: "Tu perfil de repartidor aún no ha sido aprobado." });
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
    const courier = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
    if (!courier?.courierApproved) throw new TRPCError({ code: "FORBIDDEN", message: "Tu perfil de repartidor está pendiente de aprobación administrativa." });
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
      if (!courier?.courierApproved) throw new TRPCError({ code: "FORBIDDEN", message: "Tu perfil de repartidor está pendiente de aprobación administrativa." });
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
      const [active] = await db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.courierId, ctx.user.id), eq(orders.status, "picked_up")));
      if (Number(active?.count ?? 0) >= MAX_ACTIVE_DELIVERIES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Ya llevas ${MAX_ACTIVE_DELIVERIES} entregas activas. Termina una antes de tomar otra.` });
      }
      const deliveryConfirmationCode = String(randomInt(100000, 1000000));
      // La condición del WHERE hace la toma atómica: si dos repartidores pulsan a la vez, solo uno gana.
      const [res] = await db
        .update(orders)
        .set({ courierId: ctx.user.id, status: "picked_up", deliveryConfirmationCode, courierAcceptedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.status, "ready"), isNull(orders.courierId)));
      if (res.affectedRows === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido ya fue tomado" });
      }
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "courier", type: "courier_accepted" });
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "picked_up", type: order.type });
      const [biz] = await db.select().from(businesses).where(eq(businesses.id, order.businessId)).limit(1);
      if (biz) await sendPushToUser(biz.ownerId, { title: "Repartidor asignado 🛵", body: `${courier.name ?? "Un repartidor"} recogerá el pedido ${order.code}.`, url: "/panel", orderId: order.id }).catch(() => undefined);
      return { ok: true };
    }),

  // El repartidor suelta el pedido (solo poco después de tomarlo). El pedido vuelve a "listo" y se avisa de nuevo.
  release: authedQuery
    .input(z.object({ orderId: z.number().int().positive(), reason: z.string().trim().min(5, "Indica el motivo (mínimo 5 caracteres)").max(300) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN", message: "Solo un repartidor puede soltar pedidos" });
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, input.orderId), eq(orders.courierId, ctx.user.id), eq(orders.status, "picked_up"), eq(orders.type, "delivery")),
      });
      if (!order) throw new TRPCError({ code: "BAD_REQUEST", message: "No tienes este pedido activo" });
      const acceptedAt = order.courierAcceptedAt ? new Date(order.courierAcceptedAt).getTime() : 0;
      const windowMs = BUSINESS_RULES.courierReleaseWindowMin * 60_000;
      if (!acceptedAt || Date.now() - acceptedAt > windowMs) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Solo puedes soltar un pedido durante los primeros ${BUSINESS_RULES.courierReleaseWindowMin} minutos. Si hay un problema, contacta al soporte.` });
      }
      const [res] = await db.update(orders).set({
        courierId: null, status: "ready", deliveryConfirmationCode: null, courierAcceptedAt: null,
        // El plazo para que otro lo tome se reinicia, pero el cliente no espera de más.
        readyAt: new Date(), courierReminderSentAt: null,
      }).where(and(eq(orders.id, order.id), eq(orders.courierId, ctx.user.id), eq(orders.status, "picked_up")));
      if (res.affectedRows === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "El pedido ya cambió de estado" });
      await db.delete(courierLocations).where(eq(courierLocations.orderId, order.id));
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "courier", type: "courier_released", detail: input.reason });
      await notifyCouriersOrderReady(order.id);
      return { ok: true };
    }),

  // Disponibilidad para recibir avisos de pedidos nuevos
  availability: authedQuery.query(async ({ ctx }) => {
    const [row] = await getDb().select({ available: users.courierAvailable }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return { available: row?.available ?? false };
  }),
  setAvailability: authedQuery
    .input(z.object({ available: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN", message: "Regístrate como repartidor" });
      await getDb().update(users).set({ courierAvailable: input.available }).where(eq(users.id, ctx.user.id));
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
      // El código es secreto del cliente: nunca se devuelve en el panel del repartidor.
      order: { ...o, deliveryConfirmationCode: null },
      business: byId.get(o.businessId) ?? null,
      items: byOrder.get(o.id) ?? [],
    }));
  }),

  markDelivered: authedQuery
    .input(z.object({ orderId: z.number().int().positive(), confirmationCode: z.string().regex(/^\d{6}$/, "Ingresa el código de 6 dígitos") }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo un repartidor puede confirmar entregas" });
      }
      const db = getDb();
      const courier = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
      if (!courier?.courierApproved) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Tu perfil de repartidor no está aprobado" });
      }
      const order = await db.query.orders.findFirst({
        where: and(
          eq(orders.id, input.orderId),
          eq(orders.courierId, ctx.user.id),
          eq(orders.status, "picked_up"),
          eq(orders.type, "delivery"),
        ),
      });
      if (!order) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes entregar este pedido" });
      }
      if (!order.deliveryConfirmationCode || order.deliveryConfirmationCode !== input.confirmationCode) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El código de confirmación no coincide. Pide al cliente que lo revise." });
      }
      await db.update(orders).set({ status: "delivered", deliveryConfirmationCode: null, deliveredAt: new Date() }).where(eq(orders.id, order.id));
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "courier", type: "status:delivered" });
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
