import { z } from "zod";
import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { cancelOrderAndRestock } from "./lib/orders";
import { assertCustomerCanOrder } from "./lib/order-limits";
import { loadBusinessesByIds } from "./lib/business-queries";
import { toPublicBusiness } from "./lib/public-business";
import { isPackExpired } from "@contracts/packs";
import { notifyOrderStatus, sendPushToUser, sendPushToUsers } from "./lib/push-notifications";
import { isBusinessOpenNow, isBusinessPublic, isPackReservable, quoteDelivery } from "./lib/business-rules";
import { logOrderEvent } from "./lib/order-events";
import { recomputeBusinessRating, recomputeCourierRating } from "./lib/ratings";
import { canCustomerCancel } from "./lib/order-rules";
import { shouldShowCourier, toPublicCourier } from "./lib/courier-public";
import { getDb } from "./queries/connection";
import {
  businesses,
  financeSettings,
  claims,
  courierLocations,
  orderItems,
  orders,
  products,
  ratings,
  rescuePacks,
  users,
} from "@db/schema";

// 6 caracteres sin ambiguos (0/O, 1/I): ~887 millones de combinaciones
const codeSuffix = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 6);

function makeCode(prefix: string) {
  return `${prefix}-${codeSuffix()}`;
}

// Código de retiro de 6 dígitos con aleatoriedad criptográfica
function makePickupCode() {
  return String(randomInt(100000, 1000000));
}

async function loadOrderWithRelations(orderId: number) {
  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });
  if (!order) return null;
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, order.businessId),
  });
  // El cliente y el repartidor no necesitan (ni deben ver) al dueño, la nota de moderación ni los cambios pendientes
  return { order, items, business: business ? toPublicBusiness(business) : null };
}

export const ordersRouter = createRouter({
  // Pedido de delivery a domicilio
  createDelivery: authedQuery
    .input(
      z.object({
        businessId: z.number().int().positive(),
        items: z
          .array(
            z.object({
              productId: z.number().int().positive(),
              quantity: z.number().int().min(1).max(50),
            }),
          )
          .min(1)
          .max(50),
        fulfillmentMethod: z.enum(["delivery", "pickup"]).default("delivery"),
        deliveryAddress: z.string().max(300).optional(),
        // Solo obligatorias para delivery; retiro en local no usa GPS ni tarifa de envío.
        deliveryLat: z.number().min(-90).max(90).optional(),
        deliveryLng: z.number().min(-180).max(180).optional(),
        notes: z.string().max(300).optional(),
        customerPhone: z.string().max(30).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const business = await db.query.businesses.findFirst({
        where: eq(businesses.id, input.businessId),
      });
      if (!business || !isBusinessPublic(business)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El local no está disponible" });
      }
      if (!isBusinessOpenNow(business)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `El local está cerrado. Atiende de ${business.opensAt} a ${business.closesAt}.` });
      }
      const isPickup = input.fulfillmentMethod === "pickup";
      if (!isPickup && (!input.deliveryAddress || input.deliveryAddress.trim().length < 5 || input.deliveryLat == null || input.deliveryLng == null)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Para entrega a domicilio debes indicar dirección y ubicación GPS." });
      }
      const [pricingSettings] = await db.select().from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
      const pricing = pricingSettings ? { baseFee: Number(pricingSettings.deliveryBaseFee), perKm: Number(pricingSettings.deliveryPerKm), perMinute: Number(pricingSettings.deliveryPerMinute), minFee: 1.5, maxFee: 12 } : undefined;
      const quote = !isPickup ? quoteDelivery(business, input.deliveryLat!, input.deliveryLng!, pricing) : null;
      if (quote && !quote.withinRadius) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Tu ubicación está a ${quote.distanceKm} km y este local entrega hasta ${quote.radiusKm} km.` });
      }

      const prodIds = input.items.map((i) => i.productId);
      const prods = await db.select().from(products).where(
        eq(products.businessId, input.businessId),
      );
      const byId = new Map(prods.map((p) => [p.id, p]));

      let subtotal = 0;
      const itemRows: { productId: number; name: string; unitPrice: number; quantity: number }[] = [];
      for (const it of input.items) {
        const p = byId.get(it.productId);
        if (!p || !p.isAvailable || !prodIds.includes(p.id)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Producto no disponible` });
        }
        subtotal += p.price * it.quantity;
        itemRows.push({ productId: p.id, name: p.name, unitPrice: p.price, quantity: it.quantity });
      }
      if (subtotal < business.minOrder) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `El pedido mínimo de este local es $${business.minOrder.toFixed(2)}.` });
      }
      // La tarifa la calcula siempre el servidor; el cliente no puede fijarla.
      const deliveryFee = quote?.fee ?? 0;
      const serviceFee = 0.45; // Tarifa de lanzamiento al cliente; el negocio no paga comisión en esta fase.
      const total = subtotal + deliveryFee + serviceFee;

      const orderId = await db.transaction(async (tx) => {
        await assertCustomerCanOrder(tx, ctx.user.id);
        const [{ id }] = await tx
          .insert(orders)
          .values({
            code: makeCode("AR"),
            type: "delivery",
            status: "pending",
            customerId: ctx.user.id,
            businessId: input.businessId,
            subtotal,
            deliveryFee,
            fulfillmentMethod: input.fulfillmentMethod,
            serviceFee,
            total,
            deliveryAddress: isPickup ? null : input.deliveryAddress!.trim(),
            deliveryLat: isPickup ? null : input.deliveryLat!,
            deliveryLng: isPickup ? null : input.deliveryLng!,
            deliveryDistanceKm: quote?.distanceKm ?? null,
            notes: input.notes ?? null,
            customerName: ctx.user.name ?? "Cliente",
            customerPhone: input.customerPhone ?? ctx.user.phone ?? null,
          })
          .$returningId();
        await tx.insert(orderItems).values(
          itemRows.map((r) => ({ ...r, orderId: id })),
        );
        return id;
      });

      const created = await loadOrderWithRelations(orderId);
      if (created) await Promise.all([
        notifyOrderStatus({ customerId: ctx.user.id, orderId, code: created.order.code, status: "pending", type: "delivery" }),
        sendPushToUser(business.ownerId, { title: "Nuevo pedido 🧾", body: `Tienes un nuevo pedido ${created.order.code} (${isPickup ? "retiro en local" : "a domicilio"}).`, url: "/panel", orderId }).catch((error) => console.error("Error avisando nuevo pedido al comercio:", error)),
      ]);
      return created;
    }),

  // Rescate de un pack con descuento (retiro en el local)
  createRescue: authedQuery
    .input(
      z.object({
        rescuePackId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(5),
        customerPhone: z.string().max(30).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const pack = await db.query.rescuePacks.findFirst({
        where: eq(rescuePacks.id, input.rescuePackId),
      });
      if (!pack || !pack.isActive || pack.quantityLeft < input.quantity) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pack ya no está disponible" });
      }
      // Un local suspendido, sin aprobar o sin ubicación confirmada no puede recibir reservas
      const packBusiness = await db.query.businesses.findFirst({ where: eq(businesses.id, pack.businessId) });
      if (!packBusiness || !isBusinessPublic(packBusiness)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pack ya no está disponible" });
      }
      if (isPackExpired(pack.expiresAt)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pack ya venció" });
      }
      if (!isPackReservable(pack.pickupStart, pack.pickupEnd)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `La ventana de retiro de este pack (${pack.pickupStart}–${pack.pickupEnd}) ya terminó`,
        });
      }

      const total = pack.rescuePrice * input.quantity;

      const orderId = await db.transaction(async (tx) => {
        await assertCustomerCanOrder(tx, ctx.user.id);
        // Descuento atómico: solo resta si todavía queda stock suficiente.
        // Evita que dos clientes a la vez se lleven el mismo último pack.
        const [stock] = await tx
          .update(rescuePacks)
          .set({ quantityLeft: sql`${rescuePacks.quantityLeft} - ${input.quantity}` })
          .where(
            and(
              eq(rescuePacks.id, pack.id),
              eq(rescuePacks.isActive, true),
              gte(rescuePacks.quantityLeft, input.quantity),
              gt(rescuePacks.expiresAt, new Date()), // también al momento de descontar, no solo antes
            ),
          );
        if (stock.affectedRows === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este pack ya no está disponible" });
        }
        const [{ id }] = await tx
          .insert(orders)
          .values({
            code: makeCode("RS"),
            type: "rescue",
            status: "accepted", // rescate queda apartado de inmediato
            customerId: ctx.user.id,
            businessId: pack.businessId,
            subtotal: total,
            deliveryFee: 0,
            total,
            pickupCode: makePickupCode(),
            customerName: ctx.user.name ?? "Cliente",
            customerPhone: input.customerPhone ?? ctx.user.phone ?? null,
          })
          .$returningId();
        await tx.insert(orderItems).values({
          orderId: id,
          rescuePackId: pack.id,
          name: pack.title,
          unitPrice: pack.rescuePrice,
          quantity: input.quantity,
        });
        return id;
      });

      const created = await loadOrderWithRelations(orderId);
      if (created) {
        const packBusiness = await db.query.businesses.findFirst({ where: eq(businesses.id, pack.businessId) });
        const tasks: Promise<unknown>[] = [
          notifyOrderStatus({ customerId: ctx.user.id, orderId, code: created.order.code, status: "accepted", type: "rescue" }),
        ];
        if (packBusiness) tasks.push(sendPushToUser(packBusiness.ownerId, { title: "Nuevo pack reservado 🧡", body: `Se reservó tu pack ${created.order.code}.`, url: "/panel", orderId }).catch((error) => console.error("Error avisando reserva al comercio:", error)));
        await Promise.all(tasks);
      }
      return created;
    }),

  // Cotización de envío para mostrar en el carrito antes de confirmar.
  quote: authedQuery
    .input(z.object({
      businessId: z.number().int().positive(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const business = await db.query.businesses.findFirst({ where: eq(businesses.id, input.businessId) });
      if (!business || !isBusinessPublic(business)) throw new TRPCError({ code: "NOT_FOUND", message: "El local no está disponible" });
      const [settings] = await db.select().from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
      const pricing = settings ? { baseFee: Number(settings.deliveryBaseFee), perKm: Number(settings.deliveryPerKm), perMinute: Number(settings.deliveryPerMinute), minFee: 1.5, maxFee: 12 } : undefined;
      return {
        ...quoteDelivery(business, input.lat, input.lng, pricing),
        openNow: isBusinessOpenNow(business),
        opensAt: business.opensAt,
        closesAt: business.closesAt,
      };
    }),

  // Reclamo sobre un pedido. Lo puede abrir el cliente, el dueño del comercio o el repartidor
  // asignado; nadie más. Si una misma persona tiene varios roles en el pedido, `role` decide cuál.
  createClaim: authedQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      reason: z.string().trim().min(10, "Cuéntanos qué pasó (mínimo 10 caracteres)").max(500),
      role: z.enum(["customer", "business", "courier"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({ where: eq(orders.id, input.orderId) });
      if (!order) throw new TRPCError({ code: "FORBIDDEN", message: "No puedes reclamar este pedido" });
      const ownedBiz = await db.query.businesses.findFirst({
        where: and(eq(businesses.id, order.businessId), eq(businesses.ownerId, ctx.user.id)),
      });
      const roles: ("customer" | "business" | "courier")[] = [];
      if (order.customerId === ctx.user.id) roles.push("customer");
      if (ownedBiz) roles.push("business");
      if (order.courierId === ctx.user.id) roles.push("courier");
      const role = input.role ?? roles[0];
      if (!role || !roles.includes(role)) throw new TRPCError({ code: "FORBIDDEN", message: "No puedes reclamar este pedido" });
      if (role !== "customer" && order.status === "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El pedido aún no fue aceptado: si hay un problema, cancélalo" });
      }
      const [open] = await db.select({ id: claims.id }).from(claims).where(and(
        eq(claims.orderId, order.id), eq(claims.userId, ctx.user.id), eq(claims.reporterRole, role), eq(claims.status, "open"),
      )).limit(1);
      if (open) throw new TRPCError({ code: "BAD_REQUEST", message: "Ya tienes un reclamo abierto para este pedido" });
      await db.insert(claims).values({ orderId: order.id, userId: ctx.user.id, reporterRole: role, reason: input.reason });
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: role, type: "claim_opened", detail: input.reason });
      const who = role === "customer" ? "cliente" : role === "business" ? "comercio" : "repartidor";
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
      await sendPushToUsers(admins.map((a) => a.id), { title: "Nuevo reclamo 🚩", body: `Pedido ${order.code} (${who}): ${input.reason.slice(0, 80)}`, url: "/admin" }).catch(() => undefined);
      return { ok: true };
    }),

  // Calificación del cliente tras la entrega (una por pedido): comercio siempre, repartidor si hubo.
  rate: authedQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      businessStars: z.number().int().min(1).max(5),
      businessComment: z.string().trim().max(300).optional(),
      courierStars: z.number().int().min(1).max(5).optional(),
      courierComment: z.string().trim().max(300).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({ where: eq(orders.id, input.orderId) });
      if (!order || order.customerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "No puedes calificar este pedido" });
      if (order.status !== "delivered") throw new TRPCError({ code: "BAD_REQUEST", message: "Podrás calificar cuando el pedido sea entregado" });
      if (input.courierStars != null && !order.courierId) throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido no tuvo repartidor" });
      try {
        await db.insert(ratings).values({
          orderId: order.id,
          customerId: ctx.user.id,
          businessId: order.businessId,
          courierId: input.courierStars != null ? order.courierId : null,
          businessStars: input.businessStars,
          businessComment: input.businessComment || null,
          courierStars: input.courierStars ?? null,
          courierComment: input.courierStars != null ? input.courierComment || null : null,
        });
      } catch (error) {
        const e = error as { code?: string; errno?: number; cause?: { code?: string; errno?: number } };
        if (e.code === "ER_DUP_ENTRY" || e.errno === 1062 || e.cause?.code === "ER_DUP_ENTRY" || e.cause?.errno === 1062) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ya calificaste este pedido" });
        }
        throw error;
      }
      await recomputeBusinessRating(order.businessId);
      if (input.courierStars != null && order.courierId) await recomputeCourierRating(order.courierId);
      await logOrderEvent({
        orderId: order.id, actorId: ctx.user.id, actorRole: "customer", type: "rated",
        detail: `comercio ${input.businessStars}★${input.courierStars != null ? ` · repartidor ${input.courierStars}★` : ""}`,
      });
      return { ok: true };
    }),

  myRating: authedQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const [row] = await getDb().select().from(ratings).where(and(eq(ratings.orderId, input.orderId), eq(ratings.customerId, ctx.user.id))).limit(1);
      return row ?? null;
    }),

  myClaims: authedQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ ctx, input }) =>
      getDb().select().from(claims).where(and(eq(claims.orderId, input.orderId), eq(claims.userId, ctx.user.id))).orderBy(desc(claims.createdAt)),
    ),

  // Mis pedidos (cliente)
  mine: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.customerId, ctx.user.id))
      .orderBy(desc(orders.createdAt));
    const byId = await loadBusinessesByIds(rows.map((o) => o.businessId));
    return rows.map((o) => ({
      order: { ...o, courierPickupCode: null },
      business: byId.get(o.businessId) ?? null,
    }));
  }),

  liveLocation: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({ where: eq(orders.id, input.id) });
      if (!order || order.type !== "delivery" || order.status !== "picked_up" || !order.courierId) return null;
      const ownedBiz = await db.query.businesses.findFirst({
        where: and(eq(businesses.id, order.businessId), eq(businesses.ownerId, ctx.user.id)),
      });
      const allowed = order.customerId === ctx.user.id || order.courierId === ctx.user.id || !!ownedBiz || ctx.user.role === "admin";
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "No puedes consultar la ubicación de este pedido" });
      const location = await db.query.courierLocations.findFirst({ where: eq(courierLocations.orderId, order.id) });
      if (!location || location.courierId !== order.courierId) return null;
      // No mostrar una posición antigua como si fuera en vivo.
      const stale = Date.now() - new Date(location.updatedAt).getTime() > 2 * 60 * 1000;
      let etaMinutes: number | null = null;
      let remainingDistanceKm: number | null = null;
      const hasDestination = order.deliveryLat != null && order.deliveryLng != null;
      if (!stale && hasDestination) {
        const toRad = (degrees: number) => (degrees * Math.PI) / 180;
        const lat1 = toRad(location.lat);
        const lat2 = toRad(order.deliveryLat!);
        const dLat = lat2 - lat1;
        const dLng = toRad(order.deliveryLng! - location.lng);
        const haversine = Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        const earthRadiusKm = 6371;
        const straightLineKm = 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(haversine)));
        // Estimación orientativa: factor de ruta urbana 1.3 y velocidad media 18 km/h.
        remainingDistanceKm = Math.round(straightLineKm * 1.3 * 10) / 10;
        etaMinutes = straightLineKm < 0.15 ? 1 : Math.max(1, Math.ceil((remainingDistanceKm / 18) * 60));
      }
      return { ...location, stale, etaMinutes, remainingDistanceKm, hasDestination };
    }),

  byId: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const data = await loadOrderWithRelations(input.id);
      if (!data) return null;
      const { order } = data;
      // Solo el cliente, el comercio dueño o el repartidor asignado pueden verlo
      const db = getDb();
      const ownedBiz = await db.query.businesses.findFirst({
        where: and(eq(businesses.id, order.businessId), eq(businesses.ownerId, ctx.user.id)),
      });
      const allowed =
        order.customerId === ctx.user.id ||
        order.courierId === ctx.user.id ||
        !!ownedBiz ||
        ctx.user.role === "admin";
      if (!allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No puedes ver este pedido" });
      }
      // Quién lleva el pedido: solo datos públicos y solo mientras va en camino o ya fue entregado.
      // El propio repartidor no lo necesita.
      let courier: ReturnType<typeof toPublicCourier> | null = null;
      if (shouldShowCourier(order) && order.courierId !== ctx.user.id) {
        const [row] = await db.select().from(users).where(eq(users.id, order.courierId!)).limit(1);
        courier = row ? toPublicCourier(row) : null;
      }
      // Los códigos del cliente son privados; el código de recogida solo se revela al comercio dueño.
      const visibleOrder = {
        ...order,
        ...(order.customerId !== ctx.user.id ? { deliveryConfirmationCode: null, pickupCode: null } : {}),
        ...(!ownedBiz ? { courierPickupCode: null } : {}),
      };
      return { ...data, order: visibleOrder, courier };
    }),

  // El cliente genera un código nuevo (entrega o retiro) si se agotaron los intentos
  // o si sospecha que alguien lo vio. Reinicia el contador de intentos.
  regenerateCode: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, input.id), eq(orders.customerId, ctx.user.id)),
      });
      const isDelivery = order?.type === "delivery" && order.status === "picked_up";
      const isRescue = order?.type === "rescue" && ["accepted", "preparing", "ready"].includes(order.status);
      if (!order || (!isDelivery && !isRescue)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No puedes generar un código nuevo para este pedido" });
      }
      const code = String(randomInt(100000, 1000000));
      const [res] = await db
        .update(orders)
        .set(isDelivery
          ? { deliveryConfirmationCode: code, codeAttempts: 0, updatedAt: order.updatedAt }
          : { pickupCode: code, codeAttempts: 0, updatedAt: order.updatedAt })
        .where(and(eq(orders.id, order.id), eq(orders.customerId, ctx.user.id), eq(orders.status, order.status)));
      if (res.affectedRows === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El pedido cambió de estado. Actualiza la pantalla." });
      }
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "customer", type: "code_regenerated" });
      return { ok: true };
    }),

  cancel: authedQuery
    .input(z.object({ id: z.number().int().positive(), reason: z.string().trim().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: eq(orders.id, input.id),
      });
      if (!order || order.customerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No puedes cancelar este pedido" });
      }
      if (!canCustomerCancel(order.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: order.status === "cancelled"
            ? "Este pedido ya fue cancelado"
            : "Ya no puedes cancelar: el local empezó a prepararlo. Si hay un problema, envía un reclamo.",
        });
      }
      await cancelOrderAndRestock(order.id, ["pending", "accepted"], { by: "customer", reason: input.reason });
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "customer", type: "cancelled", detail: input.reason });
      const biz = await db.query.businesses.findFirst({ where: eq(businesses.id, order.businessId) });
      if (biz) await sendPushToUser(biz.ownerId, { title: "Pedido cancelado por el cliente", body: `El cliente canceló ${order.code}.`, url: "/panel", orderId: order.id }).catch(() => undefined);
      return { ok: true };
    }),
});
