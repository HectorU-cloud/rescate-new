import { z } from "zod";
import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { notifyCouriersOrderReady, notifyOrderStatus, sendPushToUser } from "./lib/push-notifications";
import { releaseOrderFromCourier } from "./lib/orders";
import { loadBusinessesByIds } from "./lib/business-queries";
import { logOrderEvent } from "./lib/order-events";
import { redactForCourierBoard } from "./lib/order-privacy";
import { codesMatch } from "./lib/codes";
import { MAX_ACTIVE_DELIVERIES, canCourierRelease, hasReachedActiveLimit } from "./lib/order-rules";
import { BUSINESS_RULES } from "@contracts/constants";
import { businesses, courierLocations, orderEvents, orderItems, orders, users, walletEntries } from "@db/schema";


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
          eq(orders.fulfillmentMethod, "delivery"),
          eq(orders.status, "ready"),
          isNull(orders.courierId),
        ),
      )
      .orderBy(desc(orders.createdAt));
    const byId = await loadBusinessesByIds(rows.map((o) => o.businessId));
    // Antes de aceptar no se revelan datos del cliente (teléfono, dirección, coordenadas, notas).
    return rows.map((o) => ({ order: redactForCourierBoard(o), business: byId.get(o.businessId) ?? null }));
  }),

  accept: authedQuery
    .input(z.object({ orderId: z.number().int().positive() }))
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
          eq(orders.fulfillmentMethod, "delivery"),
          eq(orders.status, "ready"),
          isNull(orders.courierId),
        ),
      });
      if (!order) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido ya fue tomado" });
      }
      // Quien agotó los intentos del código de retiro de este pedido no puede volver a tomarlo
      // (si no, podría repetir "tomar → 5 intentos → soltar" para seguir adivinando códigos nuevos).
      const [locked] = await db.select({ id: orderEvents.id }).from(orderEvents)
        .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.actorId, ctx.user.id), eq(orderEvents.type, "pickup_code_locked")))
        .limit(1);
      if (locked) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No puedes volver a tomar este pedido." });
      }
      const [active] = await db.select({ count: sql<number>`count(*)` }).from(orders)
        .where(and(eq(orders.courierId, ctx.user.id), inArray(orders.status, ["ready", "picked_up"])));
      if (hasReachedActiveLimit(Number(active?.count ?? 0))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Ya llevas ${MAX_ACTIVE_DELIVERIES} entregas activas. Termina una antes de tomar otra.` });
      }
      const courierPickupCode = order.courierPickupCode ?? String(randomInt(100000, 1000000));
      // La condición del WHERE hace la toma atómica: si dos repartidores pulsan a la vez, solo uno gana.
      const [res] = await db
        .update(orders)
        .set({
          courierId: ctx.user.id,
          courierAcceptedAt: new Date(),
          codeAttempts: 0,
          ...(order.courierPickupCode ? {} : { courierPickupCode }),
        })
        .where(and(eq(orders.id, order.id), eq(orders.status, "ready"), isNull(orders.courierId)));
      if (res.affectedRows === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido ya fue tomado" });
      }
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "courier", type: "courier_accepted" });
      const [biz] = await db.select().from(businesses).where(eq(businesses.id, order.businessId)).limit(1);
      if (biz) await sendPushToUser(biz.ownerId, { title: "Repartidor asignado 🛵", body: `${courier.name ?? "Un repartidor"} recogerá el pedido ${order.code}.`, url: "/panel", orderId: order.id }).catch(() => undefined);
      return { ok: true };
    }),

  confirmPickup: authedQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      pickupCode: z.string().regex(/^\d{6}$/, "Ingresa el código de 6 dígitos"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo un repartidor puede confirmar el retiro" });
      }
      const db = getDb();
      const courier = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
      if (!courier?.courierApproved) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Tu perfil de repartidor está pendiente de aprobación administrativa." });
      }
      const order = await db.query.orders.findFirst({
        where: and(
          eq(orders.id, input.orderId),
          eq(orders.courierId, ctx.user.id),
          eq(orders.type, "delivery"),
          eq(orders.fulfillmentMethod, "delivery"),
          eq(orders.status, "ready"),
        ),
      });
      if (!order) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes confirmar este pedido" });
      }
      // Puerta anti fuerza bruta (igual que en la entrega): cada intento consume uno ANTES de comparar el
      // código y la condición es atómica, así que aunque lleguen 100 intentos en paralelo solo pasan los primeros 5.
      const [gate] = await db.update(orders)
        .set({ codeAttempts: sql`${orders.codeAttempts} + 1`, updatedAt: order.updatedAt })
        .where(and(
          eq(orders.id, order.id), eq(orders.courierId, ctx.user.id), eq(orders.status, "ready"), eq(orders.type, "delivery"),
          eq(orders.fulfillmentMethod, "delivery"),
          lt(orders.codeAttempts, BUSINESS_RULES.maxCodeAttempts),
        ));
      if (gate.affectedRows === 0) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Se agotaron los intentos para confirmar el retiro. El pedido se liberó para otro repartidor." });
      }
      if (!codesMatch(order.courierPickupCode, input.pickupCode)) {
        const [fresh] = await db.select({ attempts: orders.codeAttempts }).from(orders).where(eq(orders.id, order.id)).limit(1);
        const left = Math.max(0, BUSINESS_RULES.maxCodeAttempts - (fresh?.attempts ?? BUSINESS_RULES.maxCodeAttempts));
        if (left === 0) {
          // Sin intentos: se le quita la reserva y se genera un código nuevo; ya no puede seguir probando.
          const released = await releaseOrderFromCourier(order.id, ctx.user.id, ["ready"]);
          await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "courier", type: "pickup_code_locked" });
          if (released) {
            const [biz] = await db.select().from(businesses).where(eq(businesses.id, order.businessId)).limit(1);
            if (biz) await sendPushToUser(biz.ownerId, { title: "Código de retiro bloqueado", body: `Un repartidor falló el código del pedido ${order.code} varias veces. Se liberó el pedido y el código cambió.`, url: "/panel", orderId: order.id }).catch(() => undefined);
            await notifyCouriersOrderReady(order.id);
          }
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: left > 0
            ? `El código no coincide. Pídele el código al comercio. Te quedan ${left} intento${left === 1 ? "" : "s"}.`
            : "El código no coincide y se agotaron los intentos. El pedido se liberó para otro repartidor.",
        });
      }

      const deliveryConfirmationCode = String(randomInt(100000, 1000000));
      const [done] = await db.update(orders)
        .set({ status: "picked_up", deliveryConfirmationCode, codeAttempts: 0 })
        .where(and(
          eq(orders.id, order.id),
          eq(orders.courierId, ctx.user.id),
          eq(orders.type, "delivery"),
          eq(orders.fulfillmentMethod, "delivery"),
          eq(orders.status, "ready"),
        ));
      if (done.affectedRows === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El pedido cambió de estado" });
      }

      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "courier", type: "status:picked_up" });
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "picked_up", type: order.type });
      return { ok: true };
    }),

  // El repartidor suelta el pedido (solo poco después de tomarlo). El pedido vuelve a "listo" y se avisa de nuevo.
  release: authedQuery
    .input(z.object({ orderId: z.number().int().positive(), reason: z.string().trim().min(5, "Indica el motivo (mínimo 5 caracteres)").max(300) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.appRole !== "courier") throw new TRPCError({ code: "FORBIDDEN", message: "Solo un repartidor puede soltar pedidos" });
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: and(
          eq(orders.id, input.orderId),
          eq(orders.courierId, ctx.user.id),
          inArray(orders.status, ["ready", "picked_up"]),
          eq(orders.type, "delivery"),
          eq(orders.fulfillmentMethod, "delivery"),
        ),
      });
      if (!order) throw new TRPCError({ code: "BAD_REQUEST", message: "No tienes este pedido activo" });
      if (!canCourierRelease(order.courierAcceptedAt)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Solo puedes soltar un pedido durante los primeros ${BUSINESS_RULES.courierReleaseWindowMin} minutos. Si hay un problema, contacta al soporte.` });
      }
      const released = await releaseOrderFromCourier(order.id, ctx.user.id, [order.status as "ready" | "picked_up"]);
      if (!released) throw new TRPCError({ code: "BAD_REQUEST", message: "El pedido ya cambió de estado" });
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
    const byId = await loadBusinessesByIds(rows.map((o) => o.businessId));
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
      // Los códigos se entregan verbalmente y nunca se devuelven al repartidor por API.
      order: { ...o, deliveryConfirmationCode: null, courierPickupCode: null },
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
          eq(orders.fulfillmentMethod, "delivery"),
        ),
      });
      if (!order) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes entregar este pedido" });
      }
      // Puerta anti fuerza bruta: cada intento consume uno ANTES de comparar el código y la condición
      // es atómica, así que aunque lleguen 100 intentos en paralelo solo pasan los primeros 5.
      const [gate] = await db.update(orders)
        .set({ codeAttempts: sql`${orders.codeAttempts} + 1`, updatedAt: order.updatedAt })
        .where(and(
          eq(orders.id, order.id), eq(orders.courierId, ctx.user.id), eq(orders.status, "picked_up"),
          lt(orders.codeAttempts, BUSINESS_RULES.maxCodeAttempts),
        ));
      if (gate.affectedRows === 0) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Se agotaron los intentos para confirmar esta entrega. Pide al cliente que genere un código nuevo desde su pedido." });
      }
      if (!codesMatch(order.deliveryConfirmationCode, input.confirmationCode)) {
        const [fresh] = await db.select({ attempts: orders.codeAttempts }).from(orders).where(eq(orders.id, order.id)).limit(1);
        const left = Math.max(0, BUSINESS_RULES.maxCodeAttempts - (fresh?.attempts ?? BUSINESS_RULES.maxCodeAttempts));
        if (left === 0) {
          await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "courier", type: "code_locked" });
          await sendPushToUser(order.customerId, { title: "Código de entrega bloqueado", body: "Se intentó confirmar tu entrega con un código incorrecto varias veces. Genera un código nuevo desde tu pedido.", orderId: order.id }).catch(() => undefined);
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: left > 0
            ? `El código no coincide. Te quedan ${left} intento${left === 1 ? "" : "s"}.`
            : "El código no coincide y se agotaron los intentos. Pide al cliente que genere un código nuevo.",
        });
      }
      const [done] = await db.transaction(async (tx) => {
        const [updated] = await tx.update(orders).set({ status: "delivered", deliveryConfirmationCode: null, deliveredAt: new Date() })
          .where(and(eq(orders.id, order.id), eq(orders.courierId, ctx.user.id), eq(orders.status, "picked_up")));
        if (updated.affectedRows > 0 && order.type === "delivery" && Number(order.serviceFee) > 0) {
          await tx.insert(walletEntries).values({
            walletType: "courier", walletId: ctx.user.id, entryType: "charge",
            amount: Number(order.serviceFee), status: "confirmed", orderId: order.id,
            description: `Tarifa de servicio del pedido ${order.code}`,
          });
        }
        return [updated] as const;
      });
      if (done.affectedRows === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "El pedido ya cambió de estado" });
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
      .where(and(eq(orders.courierId, ctx.user.id), inArray(orders.status, ["ready", "picked_up"])));
    const [me] = await db.select({ rating: users.courierRating, ratingCount: users.courierRatingCount }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return {
      deliveries: Number(row?.deliveries ?? 0),
      earnings: Number(row?.earnings ?? 0),
      active: Number(activeRow?.count ?? 0),
      rating: me?.rating ?? null,
      ratingCount: me?.ratingCount ?? 0,
    };
  }),
});
