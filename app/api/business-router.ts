import { z } from "zod";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { cancelOrderAndRestock } from "./lib/orders";
import { getDb } from "./queries/connection";
import { BUSINESS_RULES } from "@contracts/constants";
import { createImageUploadUrl, type SupportedImageMime } from "./lib/image-storage";
import { notifyCouriersOrderReady, notifyOrderStatus, sendPushToUsers } from "./lib/push-notifications";
import { logOrderEvent } from "./lib/order-events";
import { MIN_CANCEL_REASON_LENGTH, businessCancelNeedsReason, businessCancelableFrom, canBusinessCancel } from "./lib/order-rules";
import { startOfDayEcuador } from "./lib/business-rules";
import {
  businesses,
  orderItems,
  orders,
  products,
  ratings,
  rescuePacks,
  users,
  type OrderStatus,
} from "@db/schema";

async function requireMyBusiness(userId: number) {
  const biz = await getDb().query.businesses.findFirst({
    where: eq(businesses.ownerId, userId),
  });
  if (!biz) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Primero registra tu negocio",
    });
  }
  return biz;
}

// Transiciones que el comercio puede aplicar
const BUSINESS_NEXT: Record<string, OrderStatus[]> = {
  pending: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"], // cancelar en cocina: solo delivery (ver canBusinessCancel)
  ready: ["delivered", "cancelled"], // rescate: entregar al retirar; delivery: lo toma el repartidor o se cancela
};

export const businessRouter = createRouter({
  // URL prefirmada para subir una imagen directamente a S3/R2 sin enviar Base64 al backend.
  createImageUpload: authedQuery
    .input(z.object({
      contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      kind: z.enum(["product", "rescue-pack"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      return createImageUploadUrl({
        businessId: biz.id,
        contentType: input.contentType as SupportedImageMime,
        kind: input.kind,
      });
    }),
  myBusiness: authedQuery.query(async ({ ctx }) => {
    return (
      (await getDb().query.businesses.findFirst({
        where: eq(businesses.ownerId, ctx.user.id),
      })) ?? null
    );
  }),

  upsertBusiness: authedQuery
    .input(
      z.object({
        name: z.string().min(2).max(150),
        description: z.string().max(500).optional(),
        category: z.string().min(2).max(60),
        address: z.string().min(5).max(255),
        phone: z.string().max(30).optional(),
        emoji: z.string().max(8).optional(),
        deliveryFee: z.number().min(0).max(20),
        deliveryMinutes: z.number().min(5).max(120),
        // Reglas de entrega (opcionales para no romper formularios existentes)
        feePerKm: z.number().min(0).max(5).optional(),
        deliveryRadiusKm: z.number().min(0.5).max(BUSINESS_RULES.maxDeliveryRadiusKm).optional(),
        minOrder: z.number().min(0).max(200).optional(),
        opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)").optional(),
        closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.businesses.findFirst({
        where: eq(businesses.ownerId, ctx.user.id),
      });
      if (existing) {
        await db
          .update(businesses)
          // Un comercio rechazado que corrige sus datos vuelve a revisión.
          .set({ ...input, ...(existing.approvalStatus === "rejected" ? { approvalStatus: "pending" as const, approvalNote: null } : {}) })
          .where(eq(businesses.id, existing.id));
        return { id: existing.id };
      }
      const [{ id }] = await db
        .insert(businesses)
        .values({
          ...input,
          ownerId: ctx.user.id,
          lat: -2.134 + (Math.random() - 0.5) * 0.01,
          lng: -79.594 + (Math.random() - 0.5) * 0.01,
          approvalStatus: "pending",
        })
        .$returningId();
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
      await sendPushToUsers(admins.map((a) => a.id), { title: "Nuevo comercio por aprobar 🏪", body: `${input.name} solicita publicarse.`, url: "/admin" }).catch(() => undefined);
      return { id };
    }),

  // Reglas de entrega y horario (sin tocar el resto de datos del local)
  updateRules: authedQuery
    .input(
      z.object({
        deliveryFee: z.number().min(0).max(20),
        feePerKm: z.number().min(0).max(5),
        deliveryRadiusKm: z.number().min(0.5).max(BUSINESS_RULES.maxDeliveryRadiusKm),
        minOrder: z.number().min(0).max(200),
        opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)"),
        closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      await getDb().update(businesses).set(input).where(eq(businesses.id, biz.id));
      return { ok: true };
    }),

  toggleOpen: authedQuery
    .input(z.object({ isOpen: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      if (input.isOpen && biz.approvalStatus !== "approved") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tu negocio aún no ha sido aprobado por el equipo." });
      }
      await getDb()
        .update(businesses)
        .set({ isOpen: input.isOpen })
        .where(eq(businesses.id, biz.id));
      return { ok: true };
    }),

  // Pedidos del comercio (activos e historial)
  orders: authedQuery
    .input(z.object({ activeOnly: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const db = getDb();
      const rows = await db
        .select()
        .from(orders)
        .where(eq(orders.businessId, biz.id))
        .orderBy(desc(orders.createdAt));
      const filtered = input?.activeOnly
        ? rows.filter((o) => !["delivered", "cancelled"].includes(o.status))
        : rows;
      const ids = filtered.map((o) => o.id);
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
      return filtered.map((o) => ({
        // El código de confirmación es exclusivo del cliente; el comercio no debe verlo.
        order: { ...o, deliveryConfirmationCode: null },
        items: byOrder.get(o.id) ?? [],
      }));
    }),

  updateOrderStatus: authedQuery
    .input(z.object({ orderId: z.number().int().positive(), status: z.string(), reason: z.string().trim().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, input.orderId), eq(orders.businessId, biz.id)),
      });
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });
      const allowed = BUSINESS_NEXT[order.status] ?? [];
      // Para delivery, el comercio no marca "delivered" (eso es del repartidor)
      const next = input.status as OrderStatus;
      const flow = allowed.filter(() =>
        order.type === "delivery" && next === "delivered" ? false : true,
      );
      if (!flow.includes(next)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No puedes pasar de "${order.status}" a "${next}"`,
        });
      }
      if (next === "cancelled") {
        if (!canBusinessCancel(order.type, order.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido ya no se puede cancelar desde el local" });
        }
        if (businessCancelNeedsReason(order.status) && (input.reason?.length ?? 0) < MIN_CANCEL_REASON_LENGTH) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indica el motivo de la cancelación (el cliente lo verá)" });
        }
        // Si era un rescate, devuelve el stock del pack. La condición de estado es atómica:
        // si un repartidor lo toma justo ahora, la cancelación falla en vez de pisarlo.
        await cancelOrderAndRestock(order.id, businessCancelableFrom(order.type), { by: "business", reason: input.reason });
        await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "business", type: "cancelled", detail: input.reason });
        await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "cancelled", type: order.type, reason: input.reason });
        return { ok: true };
      }
      const [res] = await db.update(orders).set({
        status: next,
        businessReminderSentAt: null,
        ...(next === "ready" ? { readyAt: new Date(), courierReminderSentAt: null } : {}),
        ...(next === "delivered" ? { deliveredAt: new Date() } : {}),
      }).where(and(eq(orders.id, order.id), eq(orders.status, order.status))); // evita carreras con cancelaciones
      if (res.affectedRows === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "El pedido cambió de estado. Actualiza la pantalla." });
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "business", type: `status:${next}` });
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: next, type: order.type });
      // Pedido de delivery listo: avisar a los repartidores disponibles
      if (next === "ready" && order.type === "delivery") await notifyCouriersOrderReady(order.id);
      return { ok: true };
    }),

  // --- Productos ---
  products: authedQuery.query(async ({ ctx }) => {
    const biz = await requireMyBusiness(ctx.user.id);
    return getDb()
      .select()
      .from(products)
      .where(eq(products.businessId, biz.id))
      .orderBy(desc(products.createdAt));
  }),

  upsertProduct: authedQuery
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().min(2).max(150),
        description: z.string().max(300).optional(),
        imageUrl: z.string().max(500_000).optional().nullable(),
        price: z.number().min(0.1).max(500),
        emoji: z.string().max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.imageUrl && !/^data:image\/(jpeg|png|webp);base64,/.test(input.imageUrl) && !/^https:\/\//.test(input.imageUrl)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La imagen debe ser JPG, PNG, WebP o una URL HTTPS." });
      }
      const biz = await requireMyBusiness(ctx.user.id);
      const db = getDb();
      if (input.id) {
        await db
          .update(products)
          .set({
            name: input.name,
            description: input.description ?? null,
            imageUrl: input.imageUrl ?? null,
            price: input.price,
            emoji: input.emoji ?? "🍽️",
          })
          .where(
            and(eq(products.id, input.id), eq(products.businessId, biz.id)),
          );
        return { id: input.id };
      }
      const [{ id }] = await db
        .insert(products)
        .values({
          businessId: biz.id,
          name: input.name,
          description: input.description ?? null,
          imageUrl: input.imageUrl ?? null,
          price: input.price,
          emoji: input.emoji ?? "🍽️",
        })
        .$returningId();
      return { id };
    }),

  toggleProduct: authedQuery
    .input(z.object({ id: z.number(), isAvailable: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      await getDb()
        .update(products)
        .set({ isAvailable: input.isAvailable })
        .where(and(eq(products.id, input.id), eq(products.businessId, biz.id)));
      return { ok: true };
    }),

  // --- Packs de rescate ---
  rescuePacks: authedQuery.query(async ({ ctx }) => {
    const biz = await requireMyBusiness(ctx.user.id);
    return getDb()
      .select()
      .from(rescuePacks)
      .where(eq(rescuePacks.businessId, biz.id))
      .orderBy(desc(rescuePacks.createdAt));
  }),

  createRescuePack: authedQuery
    .input(
      z.object({
        title: z.string().min(2).max(150),
        description: z.string().max(300).optional(),
        imageUrl: z.string().max(500_000).optional().nullable(),
        originalPrice: z.number().min(0.5).max(500),
        rescuePrice: z.number().min(0.25).max(500),
        quantityTotal: z.number().min(1).max(100),
        pickupStart: z.string().regex(/^\d{2}:\d{2}$/),
        pickupEnd: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      if (input.imageUrl && !/^data:image\/(jpeg|png|webp);base64,/.test(input.imageUrl) && !/^https:\/\//.test(input.imageUrl)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La imagen debe ser JPG, PNG, WebP o una URL HTTPS." });
      }
      if (input.rescuePrice >= input.originalPrice) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El precio de rescate debe ser menor al precio original",
        });
      }
      const [{ id }] = await getDb()
        .insert(rescuePacks)
        .values({
          businessId: biz.id,
          title: input.title,
          description: input.description ?? null,
          imageUrl: input.imageUrl ?? null,
          originalPrice: input.originalPrice,
          rescuePrice: input.rescuePrice,
          quantityTotal: input.quantityTotal,
          quantityLeft: input.quantityTotal,
          pickupStart: input.pickupStart,
          pickupEnd: input.pickupEnd,
        })
        .$returningId();
      return { id };
    }),

  toggleRescuePack: authedQuery
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      await getDb()
        .update(rescuePacks)
        .set({ isActive: input.isActive })
        .where(
          and(eq(rescuePacks.id, input.id), eq(rescuePacks.businessId, biz.id)),
        );
      return { ok: true };
    }),

  // Reseñas visibles únicamente para el dueño del comercio autenticado.
  reviews: authedQuery.query(async ({ ctx }) => {
    const biz = await requireMyBusiness(ctx.user.id);
    const rows = await getDb()
      .select({
        id: ratings.id,
        orderId: ratings.orderId,
        businessStars: ratings.businessStars,
        businessComment: ratings.businessComment,
        createdAt: ratings.createdAt,
        customerName: users.name,
      })
      .from(ratings)
      .leftJoin(users, eq(users.id, ratings.customerId))
      .where(eq(ratings.businessId, biz.id))
      .orderBy(desc(ratings.createdAt), desc(ratings.id))
      .limit(100);
    // Al comercio solo se le muestra el primer nombre del cliente (igual que el chat y la tarjeta del repartidor).
    return rows.map((r) => ({ ...r, customerName: r.customerName?.trim().split(/\s+/)[0] || null }));
  }),

  // --- Estadísticas ---
  // Ventas = lo que cobra el local (subtotal de pedidos ENTREGADOS). El envío no cuenta: es del repartidor.
  stats: authedQuery.query(async ({ ctx }) => {
    const biz = await requireMyBusiness(ctx.user.id);
    const db = getDb();
    const startOfDay = startOfDayEcuador();
    const [row] = await db
      .select({
        count: sql<number>`count(*)`,
        delivered: sql<number>`coalesce(sum(case when ${orders.status} = 'delivered' then 1 else 0 end), 0)`,
        sales: sql<number>`coalesce(sum(case when ${orders.status} = 'delivered' then ${orders.subtotal} else 0 end), 0)`,
        rescues: sql<number>`coalesce(sum(case when ${orders.type} = 'rescue' and ${orders.status} != 'cancelled' then 1 else 0 end), 0)`,
        active: sql<number>`coalesce(sum(case when ${orders.status} in ('pending','accepted','preparing','ready') then 1 else 0 end), 0)`,
      })
      .from(orders)
      .where(eq(orders.businessId, biz.id));
    const [today] = await db
      .select({
        delivered: sql<number>`count(*)`,
        sales: sql<number>`coalesce(sum(${orders.subtotal}), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.businessId, biz.id), eq(orders.status, "delivered"), gte(orders.deliveredAt, startOfDay)));
    const [created] = await db
      .select({ count: sql<number>`coalesce(sum(case when ${orders.status} != 'cancelled' then 1 else 0 end), 0)` })
      .from(orders)
      .where(and(eq(orders.businessId, biz.id), gte(orders.createdAt, startOfDay)));
    return {
      totalOrders: Number(row?.count ?? 0),
      deliveredOrders: Number(row?.delivered ?? 0),
      revenue: Number(row?.sales ?? 0), // ventas totales (sin envío), solo entregados
      rescues: Number(row?.rescues ?? 0),
      activeOrders: Number(row?.active ?? 0),
      todayOrders: Number(created?.count ?? 0), // pedidos recibidos hoy (sin cancelados)
      todayDelivered: Number(today?.delivered ?? 0),
      todaySales: Number(today?.sales ?? 0),
      rating: biz.rating,
      ratingCount: biz.ratingCount,
    };
  }),
});
