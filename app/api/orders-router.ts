import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { cancelOrderAndRestock } from "./lib/orders";
import { notifyOrderStatus, sendPushToUser } from "./lib/push-notifications";
import { getDb } from "./queries/connection";
import {
  businesses,
  courierLocations,
  courierReviews,
  deliveryMessages,
  users,
  orderItems,
  orders,
  products,
  rescuePacks,
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
  return { order, items, business: business ?? null };
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
        deliveryAddress: z.string().min(5).max(300),
        notes: z.string().max(300).optional(),
        customerPhone: z.string().max(30).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const business = await db.query.businesses.findFirst({
        where: eq(businesses.id, input.businessId),
      });
      if (!business || !business.isOpen) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El local no está disponible" });
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
      const deliveryFee = business.deliveryFee;
      const total = subtotal + deliveryFee;

      const orderId = await db.transaction(async (tx) => {
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
            total,
            deliveryAddress: input.deliveryAddress,
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
        sendPushToUser(business.ownerId, { title: "Nuevo pedido 🧾", body: `Tienes un nuevo pedido ${created.order.code} de delivery.`, url: "/panel", orderId }).catch((error) => console.error("Error avisando nuevo pedido al comercio:", error)),
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

      const total = pack.rescuePrice * input.quantity;

      const orderId = await db.transaction(async (tx) => {
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

  // Mis pedidos (cliente)
  mine: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.customerId, ctx.user.id))
      .orderBy(desc(orders.createdAt));
    const bizRows = await db.select().from(businesses);
    const byId = new Map(bizRows.map((b) => [b.id, b]));
    return rows.map((o) => ({ order: o, business: byId.get(o.businessId) ?? null }));
  }),

  liveLocation: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({ where: eq(orders.id, input.id) });
      if (!order || order.type !== "delivery" || !(["assigned", "arrived", "picked_up"] as string[]).includes(order.status) || !order.courierId) return null;
      const ownedBiz = await db.query.businesses.findFirst({
        where: and(eq(businesses.id, order.businessId), eq(businesses.ownerId, ctx.user.id)),
      });
      const allowed = order.customerId === ctx.user.id || order.courierId === ctx.user.id || !!ownedBiz || ctx.user.role === "admin";
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "No puedes consultar la ubicación de este pedido" });
      const location = await db.query.courierLocations.findFirst({ where: eq(courierLocations.orderId, order.id) });
      if (!location || location.courierId !== order.courierId) return null;
      // No mostrar una posición antigua como si fuera en vivo.
      if (Date.now() - new Date(location.updatedAt).getTime() > 2 * 60 * 1000) return { ...location, stale: true };
      return { ...location, stale: false };
    }),

  chatMessages: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({ where: eq(orders.id, input.id) });
      if (!order || order.type !== "delivery" || !order.courierId || ![order.customerId, order.courierId].includes(ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "El chat está disponible para el cliente y el repartidor asignado" });
      }
      const messages = await db.select().from(deliveryMessages).where(eq(deliveryMessages.orderId, order.id)).orderBy(deliveryMessages.createdAt);
      return messages.map((m) => ({ ...m, mine: m.senderId === ctx.user.id }));
    }),

  sendChatMessage: authedQuery
    .input(z.object({ id: z.number().int().positive(), body: z.string().trim().min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({ where: eq(orders.id, input.id) });
      if (!order || order.type !== "delivery" || !order.courierId || ![order.customerId, order.courierId].includes(ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No tienes acceso a este chat" });
      }
      if (["delivered", "cancelled"].includes(order.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "El chat está cerrado porque la entrega finalizó" });
      const [created] = await db.insert(deliveryMessages).values({ orderId: order.id, senderId: ctx.user.id, body: input.body }).$returningId();
      const recipientId = ctx.user.id === order.customerId ? order.courierId : order.customerId;
      await sendPushToUser(recipientId, { title: "Nuevo mensaje de entrega", body: input.body.slice(0, 120), url: `/orders/${order.id}`, orderId: order.id }).catch((error) => console.error("No se pudo enviar aviso de chat:", error));
      return { ok: true, id: created.id };
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
      let courier = null;
      if (order.type === "delivery" && order.courierId && order.customerId === ctx.user.id) {
        const person = await db.query.users.findFirst({ where: eq(users.id, order.courierId) });
        const [stats] = await db.select({ rating: sql<number>`coalesce(avg(${courierReviews.rating}), 0)`, reviewCount: sql<number>`count(*)` }).from(courierReviews).where(eq(courierReviews.courierId, order.courierId));
        const [countRow] = await db.select({ deliveries: sql<number>`count(*)` }).from(orders).where(and(eq(orders.courierId, order.courierId), eq(orders.status, "delivered")));
        if (person) courier = { id: person.id, name: person.name, photoUrl: person.courierPhotoUrl ?? person.avatar, vehicle: person.courierVehicle, plate: person.courierPlate, bio: person.courierBio, verificationStatus: person.courierVerificationStatus, rating: Number(stats?.rating ?? 0), reviewCount: Number(stats?.reviewCount ?? 0), deliveries: Number(countRow?.deliveries ?? 0) };
      }
      return { ...data, courier };
    }),

  cancel: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: eq(orders.id, input.id),
      });
      if (!order || order.customerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No puedes cancelar este pedido" });
      }
      if (!["pending", "accepted"].includes(order.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ya no se puede cancelar" });
      }
      await cancelOrderAndRestock(order.id, ["pending", "accepted"]);
      return { ok: true };
    }),
});
