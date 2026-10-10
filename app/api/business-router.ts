import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { cancelOrderAndRestock } from "./lib/orders";
import { getDb } from "./queries/connection";
import {
  businesses,
  orderItems,
  orders,
  products,
  rescuePacks,
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
  preparing: ["ready"],
  ready: ["delivered"], // rescate: entregar al retirar; delivery: lo toma el repartidor
};

export const businessRouter = createRouter({
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
          .set(input)
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
        })
        .$returningId();
      return { id };
    }),

  toggleOpen: authedQuery
    .input(z.object({ isOpen: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
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
      return filtered.map((o) => ({ order: o, items: byOrder.get(o.id) ?? [] }));
    }),

  updateOrderStatus: authedQuery
    .input(z.object({ orderId: z.number().int().positive(), status: z.string() }))
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
        // Si era un rescate, devuelve el stock del pack
        await cancelOrderAndRestock(order.id, ["pending", "accepted"]);
        return { ok: true };
      }
      await db.update(orders).set({ status: next }).where(eq(orders.id, order.id));
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
        price: z.number().min(0.1).max(500),
        emoji: z.string().max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const db = getDb();
      if (input.id) {
        await db
          .update(products)
          .set({
            name: input.name,
            description: input.description ?? null,
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
        originalPrice: z.number().min(0.5).max(500),
        rescuePrice: z.number().min(0.25).max(500),
        quantityTotal: z.number().min(1).max(100),
        pickupStart: z.string().regex(/^\d{2}:\d{2}$/),
        pickupEnd: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
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

  // --- Estadísticas del día ---
  stats: authedQuery.query(async ({ ctx }) => {
    const biz = await requireMyBusiness(ctx.user.id);
    const db = getDb();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [row] = await db
      .select({
        count: sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(case when status != 'cancelled' then total else 0 end), 0)`,
        rescues: sql<number>`coalesce(sum(case when type = 'rescue' and status != 'cancelled' then 1 else 0 end), 0)`,
      })
      .from(orders)
      .where(eq(orders.businessId, biz.id));
    const pending = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(
        and(
          eq(orders.businessId, biz.id),
          inArray(orders.status, ["pending", "accepted", "preparing", "ready"]),
        ),
      );
    void startOfDay;
    return {
      totalOrders: Number(row?.count ?? 0),
      revenue: Number(row?.revenue ?? 0),
      rescues: Number(row?.rescues ?? 0),
      activeOrders: Number(pending[0]?.count ?? 0),
    };
  }),
});
