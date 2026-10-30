import { z } from "zod";
import {and,asc,desc,eq,gte,inArray,isNotNull,lt,or,sql,} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { cancelOrderAndRestock } from "./lib/orders";
import { logOrderEvent } from "./lib/order-events";
import { notifyOrderStatus, sendPushToUser } from "./lib/push-notifications";
import { businesses, claims, courierLocations, orderEvents, orders, ratings, users, walletEntries, financeSettings, settlements } from "@db/schema";
import { buildStatements, hasActivity, periodBounds, type WalletRef } from "@contracts/wallet";
import { notifyPaymentReview } from "./lib/wallet";

const daysAgo = (n: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};

const ACTIVE_STATUSES = ["pending", "accepted", "preparing", "ready", "picked_up"] as const;

/** Nombres de todas las cuentas (repartidores y comercios) para mostrar en reportes. */
async function loadWalletNames() {
  const db = getDb();
  const couriers = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.appRole, "courier"));
  const biz = await db.select({ id: businesses.id, name: businesses.name }).from(businesses);
  const names = new Map<string, string>();
  for (const c of couriers) names.set(`courier:${c.id}`, c.name ?? `Repartidor #${c.id}`);
  for (const b of biz) names.set(`business:${b.id}`, b.name);
  return (ref: WalletRef) => names.get(`${ref.walletType}:${ref.walletId}`) ?? `${ref.walletType === "courier" ? "Repartidor" : "Comercio"} #${ref.walletId}`;
}

const periodInput = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
function boundsOrThrow(from: string, to: string) {
  try { return periodBounds(from, to); } catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Período inválido." }); }
}
async function statementsForPeriod(start: Date, end: Date) {
  // Un movimiento creado después del fin del período no puede afectarlo (el pago cuenta al confirmarse, siempre después de crearse).
  const entries = await getDb().select({ walletType: walletEntries.walletType, walletId: walletEntries.walletId, entryType: walletEntries.entryType, amount: walletEntries.amount, status: walletEntries.status, createdAt: walletEntries.createdAt, reviewedAt: walletEntries.reviewedAt })
    .from(walletEntries).where(lt(walletEntries.createdAt, end));
  return buildStatements(entries.map((e) => ({ ...e, walletId: Number(e.walletId) })), start.getTime(), end.getTime()).filter(hasActivity);
}

export const adminRouter = createRouter({
  // --------------------------------------------------------------- Finanzas
  financeSettings: adminQuery.query(async () => {
    const db = getDb();
    const [row] = await db.select().from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
    if (row) return row;
    await db.insert(financeSettings).values({ id: 1, serviceFee: 0.45, courierDebtLimit: 5, businessDebtLimit: 15, deliveryBaseFee: 0.8, deliveryPerKm: 0.3, deliveryPerMinute: 0.04, dynamicPricingEnabled: false });
    const [created] = await db.select().from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
    return created!;
  }),

  updateFinanceSettings: adminQuery.input(z.object({
    serviceFee: z.number().min(0).max(10),
    courierDebtLimit: z.number().min(0).max(10000),
    businessDebtLimit: z.number().min(0).max(100000),
    deliveryBaseFee: z.number().min(0).max(100),
    deliveryPerKm: z.number().min(0).max(100),
    deliveryPerMinute: z.number().min(0).max(10),
    dynamicPricingEnabled: z.boolean(),
    paymentInstructions: z.string().trim().max(1000).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const [exists] = await db.select({ id: financeSettings.id }).from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
    if (exists) {
      await db.update(financeSettings).set({ ...input, updatedBy: ctx.user.id }).where(eq(financeSettings.id, 1));
    } else {
      await db.insert(financeSettings).values({ id: 1, ...input, updatedBy: ctx.user.id });
    }
    const [row] = await db.select().from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
    return row!;
  }),

  financeWallets: adminQuery.query(async () => {
    const db = getDb();
    const entries = await db.select({ walletType: walletEntries.walletType, walletId: walletEntries.walletId, entryType: walletEntries.entryType, amount: walletEntries.amount, status: walletEntries.status })
      .from(walletEntries);
    const couriers = await db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, courierApproved: users.courierApproved })
      .from(users).where(eq(users.appRole, "courier"));
    const biz = await db.select({ id: businesses.id, name: businesses.name, ownerId: businesses.ownerId, ownerName: users.name, ownerEmail: users.email, approvalStatus: businesses.approvalStatus })
      .from(businesses).leftJoin(users, eq(users.id, businesses.ownerId));
    const calculate = (type: "courier" | "business", id: number) => {
      const own = entries.filter((e) => e.walletType === type && Number(e.walletId) === id);
      const balance = own.filter((e) => e.status === "confirmed").reduce((sum, e) => sum + (e.entryType === "charge" ? Number(e.amount) : e.entryType === "payment" ? -Number(e.amount) : Number(e.amount)), 0);
      const pendingPayments = own.filter((e) => e.entryType === "payment" && e.status === "pending").reduce((sum, e) => sum + Number(e.amount), 0);
      return { balance: Math.round(balance * 100) / 100, pendingPayments: Math.round(pendingPayments * 100) / 100 };
    };
    return [
      ...couriers.map((u) => ({ walletType: "courier" as const, walletId: u.id, name: u.name ?? "Repartidor sin nombre", email: u.email, phone: u.phone, active: u.courierApproved, ...calculate("courier", u.id) })),
      ...biz.map((b) => ({ walletType: "business" as const, walletId: b.id, name: b.name, email: b.ownerEmail, phone: null, active: b.approvalStatus === "approved", ownerName: b.ownerName, ...calculate("business", b.id) })),
    ].sort((a, b) => b.balance - a.balance);
  }),

  financeEntries: adminQuery.input(z.object({ walletType: z.enum(["courier", "business"]).optional(), walletId: z.number().int().positive().optional(), status: z.enum(["pending", "confirmed", "rejected"]).optional() }).optional()).query(async ({ input }) => {
    const db = getDb();
    const conditions = [];
    if (input?.walletType) conditions.push(eq(walletEntries.walletType, input.walletType));
    if (input?.walletId) conditions.push(eq(walletEntries.walletId, input.walletId));
    if (input?.status) conditions.push(eq(walletEntries.status, input.status));
    const rows = await db.select({ id: walletEntries.id, walletType: walletEntries.walletType, walletId: walletEntries.walletId, entryType: walletEntries.entryType, amount: walletEntries.amount, status: walletEntries.status, orderId: walletEntries.orderId, description: walletEntries.description, paymentReference: walletEntries.paymentReference, proofUrl: walletEntries.proofUrl, reviewNote: walletEntries.reviewNote, createdAt: walletEntries.createdAt, reviewedAt: walletEntries.reviewedAt })
      .from(walletEntries).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(walletEntries.createdAt)).limit(250);
    const nameOf = await loadWalletNames();
    return rows.map((r) => ({ ...r, walletName: nameOf({ walletType: r.walletType, walletId: Number(r.walletId) }) }));
  }),

  createFinanceEntry: adminQuery.input(z.object({ walletType: z.enum(["courier", "business"]), walletId: z.number().int().positive(), entryType: z.enum(["charge", "payment"]), amount: z.number().positive().max(100000), description: z.string().trim().min(3).max(300), paymentReference: z.string().trim().max(120).optional(), orderId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    const db = getDb();

    // walletId is polymorphic, so validate both the account type and its existence here.
    // A normal SQL foreign key cannot conditionally point to users or businesses.
    if (input.walletType === "courier") {
      const [wallet] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, input.walletId), eq(users.appRole, "courier"))).limit(1);
      if (!wallet) throw new TRPCError({ code: "BAD_REQUEST", message: "El repartidor seleccionado no existe o no tiene el rol de repartidor." });
    } else {
      const [wallet] = await db.select({ id: businesses.id }).from(businesses)
        .where(eq(businesses.id, input.walletId)).limit(1);
      if (!wallet) throw new TRPCError({ code: "BAD_REQUEST", message: "El comercio seleccionado no existe." });
    }

    if (input.orderId !== undefined) {
      const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, input.orderId)).limit(1);
      if (!order) throw new TRPCError({ code: "BAD_REQUEST", message: "El pedido asociado no existe." });
    }

    if (input.entryType === "charge") {
      await db.insert(walletEntries).values({ ...input, status: "confirmed", createdBy: ctx.user.id });
    } else {
      await db.insert(walletEntries).values({ ...input, status: "pending", createdBy: ctx.user.id });
    }
    return { ok: true };
  }),

  reviewFinancePayment: adminQuery.input(z.object({ entryId: z.number().int().positive(), decision: z.enum(["confirmed", "rejected"]), note: z.string().trim().max(300).optional() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    if (input.decision === "rejected" && (input.note ?? "").length < 3) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Indica el motivo del rechazo (mínimo 3 caracteres): la persona lo verá." });
    }
    const [entry] = await db.select().from(walletEntries).where(eq(walletEntries.id, input.entryId)).limit(1);
    if (!entry || entry.entryType !== "payment" || entry.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "El pago ya fue revisado o no existe." });
    const [res] = await db.update(walletEntries)
      .set({ status: input.decision, reviewedBy: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note || null })
      .where(and(eq(walletEntries.id, input.entryId), eq(walletEntries.status, "pending")));
    // Si otro admin lo revisó justo antes, la condición no actualiza nada: no avisamos dos veces.
    if (res.affectedRows === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "El pago ya fue revisado o no existe." });
    await notifyPaymentReview(entry, input.decision, input.note);
    return { ok: true };
  }),

  /** Cargos, pagos y deuda de cada cuenta en un período (hora de Ecuador, ambas fechas incluidas). */
  financeReport: adminQuery.input(periodInput).query(async ({ input }) => {
    const { start, end, days } = boundsOrThrow(input.from, input.to);
    const nameOf = await loadWalletNames();
    const rows = (await statementsForPeriod(start, end)).map((s) => ({ ...s, name: nameOf(s) }));
    const sum = (type: "courier" | "business", key: "charges" | "payments" | "closingBalance") =>
      Math.round(rows.filter((r) => r.walletType === type).reduce((acc, r) => acc + r[key], 0) * 100) / 100;
    return {
      from: input.from, to: input.to, days,
      rows,
      totals: {
        courier: { charges: sum("courier", "charges"), payments: sum("courier", "payments"), closingBalance: sum("courier", "closingBalance") },
        business: { charges: sum("business", "charges"), payments: sum("business", "payments"), closingBalance: sum("business", "closingBalance") },
      },
    };
  }),

  /**
   * Genera la liquidación (constancia del estado de cuenta) de cada cuenta con actividad en el período.
   * Solo períodos ya terminados, y es idempotente: las cuentas que ya tienen su liquidación se omiten.
   */
  createSettlements: adminQuery.input(periodInput).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const { start, end } = boundsOrThrow(input.from, input.to);
    if (end.getTime() > Date.now()) throw new TRPCError({ code: "BAD_REQUEST", message: "El período aún no termina: liquida solo días ya cerrados." });
    const statements = await statementsForPeriod(start, end);
    const existing = await db.select({ walletType: settlements.walletType, walletId: settlements.walletId }).from(settlements)
      .where(and(eq(settlements.periodStart, start), eq(settlements.periodEnd, end)));
    const done = new Set(existing.map((e) => `${e.walletType}:${Number(e.walletId)}`));
    const pending = statements.filter((s) => !done.has(`${s.walletType}:${s.walletId}`));
    if (pending.length) {
      try {
        await db.insert(settlements).values(pending.map((s) => ({ ...s, periodStart: start, periodEnd: end, createdBy: ctx.user.id })));
      } catch (error) {
        const e = error as { code?: string; errno?: number; cause?: { code?: string; errno?: number } };
        if (e.code === "ER_DUP_ENTRY" || e.errno === 1062 || e.cause?.code === "ER_DUP_ENTRY" || e.cause?.errno === 1062) {
          throw new TRPCError({ code: "CONFLICT", message: "Otra persona acaba de generar estas liquidaciones. Actualiza la lista." });
        }
        throw error;
      }
    }
    return { created: pending.length, skipped: statements.length - pending.length };
  }),

  settlements: adminQuery.input(z.object({ walletType: z.enum(["courier", "business"]).optional() }).optional()).query(async ({ input }) => {
    const db = getDb();
    const rows = await db.select().from(settlements)
      .where(input?.walletType ? eq(settlements.walletType, input.walletType) : undefined)
      .orderBy(desc(settlements.periodEnd), desc(settlements.id)).limit(200);
    const nameOf = await loadWalletNames();
    return rows.map((r) => ({ ...r, walletId: Number(r.walletId), name: nameOf({ walletType: r.walletType, walletId: Number(r.walletId) }) }));
  }),
  // ---------------------------------------------------------------- Métricas
  overview: adminQuery.query(async () => {
    const db = getDb();
    const today = daysAgo(0);
    const weekAgo = daysAgo(6);

    const [totals] = await db.select({
      orders: sql<number>`count(*)`,
      delivered: sql<number>`coalesce(sum(case when status = 'delivered' then 1 else 0 end), 0)`,
      cancelled: sql<number>`coalesce(sum(case when status = 'cancelled' then 1 else 0 end), 0)`,
      expired: sql<number>`coalesce(sum(case when status = 'cancelled' and cancelledBy = 'system' then 1 else 0 end), 0)`,
      revenue: sql<number>`coalesce(sum(case when status = 'delivered' then total else 0 end), 0)`,
      deliveryFees: sql<number>`coalesce(sum(case when status = 'delivered' and type = 'delivery' then deliveryFee else 0 end), 0)`,
      rescues: sql<number>`coalesce(sum(case when status = 'delivered' and type = 'rescue' then 1 else 0 end), 0)`,
      avgDeliveryMin: sql<number | null>`avg(case when status = 'delivered' and type = 'delivery' and deliveredAt is not null then timestampdiff(minute, createdAt, deliveredAt) else null end)`,
    }).from(orders);

    const [todayRow] = await db.select({
      orders: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(case when status = 'delivered' then total else 0 end), 0)`,
    }).from(orders).where(gte(orders.createdAt, today));

    const [active] = await db.select({ count: sql<number>`count(*)` }).from(orders).where(inArray(orders.status, [...ACTIVE_STATUSES]));
    const [waitingCourier] = await db.select({ count: sql<number>`count(*)` }).from(orders)
      .where(and(eq(orders.type, "delivery"), eq(orders.status, "ready"), sql`${orders.courierId} is null`));

    const perDay = await db.select({
      day: sql<string>`date(${orders.createdAt})`,
      orders: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(case when status = 'delivered' then total else 0 end), 0)`,
    }).from(orders).where(gte(orders.createdAt, weekAgo)).groupBy(sql`date(${orders.createdAt})`).orderBy(sql`date(${orders.createdAt})`);

    const topBusinesses = await db.select({
      id: businesses.id,
      name: businesses.name,
      orders: sql<number>`count(${orders.id})`,
      revenue: sql<number>`coalesce(sum(case when ${orders.status} = 'delivered' then ${orders.total} else 0 end), 0)`,
    }).from(orders).innerJoin(businesses, eq(orders.businessId, businesses.id))
      .groupBy(businesses.id, businesses.name).orderBy(desc(sql`count(${orders.id})`)).limit(5);

    const [pendingBusinesses] = await db.select({ count: sql<number>`count(*)` }).from(businesses).where(eq(businesses.approvalStatus, "pending"));
    const [pendingCouriers] = await db.select({ count: sql<number>`count(*)` }).from(users)
      .where(and(eq(users.appRole, "courier"), eq(users.courierVerification, "pending"), eq(users.courierApproved, false), sql`${users.courierVehicle} is not null`));
    const [availableCouriers] = await db.select({ count: sql<number>`count(*)` }).from(users)
      .where(and(eq(users.appRole, "courier"), eq(users.courierApproved, true), eq(users.courierAvailable, true)));
    const [openClaims] = await db.select({ count: sql<number>`count(*)` }).from(claims).where(eq(claims.status, "open"));

    const [bizRatings] = await db.select({ avg: sql<number | null>`avg(${ratings.businessStars})`, count: sql<number>`count(*)` }).from(ratings);
    const [courierRatings] = await db.select({ avg: sql<number | null>`avg(${ratings.courierStars})`, count: sql<number>`count(${ratings.courierStars})` }).from(ratings);
    // Comercios con al menos 3 calificaciones y rating bajo: candidatos a revisión.
    const lowRated = await db.select({ id: businesses.id, name: businesses.name, rating: businesses.rating, ratingCount: businesses.ratingCount })
      .from(businesses).where(and(gte(businesses.ratingCount, 3), lt(businesses.rating, 3.5))).orderBy(asc(businesses.rating)).limit(5);

    const totalOrders = Number(totals?.orders ?? 0);
    return {
      totalOrders,
      delivered: Number(totals?.delivered ?? 0),
      cancelled: Number(totals?.cancelled ?? 0),
      expired: Number(totals?.expired ?? 0),
      cancellationRate: totalOrders ? Number(totals?.cancelled ?? 0) / totalOrders : 0,
      revenue: Number(totals?.revenue ?? 0),
      deliveryFees: Number(totals?.deliveryFees ?? 0),
      rescues: Number(totals?.rescues ?? 0),
      avgDeliveryMin: totals?.avgDeliveryMin == null ? null : Math.round(Number(totals.avgDeliveryMin)),
      todayOrders: Number(todayRow?.orders ?? 0),
      todayRevenue: Number(todayRow?.revenue ?? 0),
      activeOrders: Number(active?.count ?? 0),
      waitingCourier: Number(waitingCourier?.count ?? 0),
      pendingBusinesses: Number(pendingBusinesses?.count ?? 0),
      pendingCouriers: Number(pendingCouriers?.count ?? 0),
      availableCouriers: Number(availableCouriers?.count ?? 0),
      openClaims: Number(openClaims?.count ?? 0),
      ratingsCount: Number(bizRatings?.count ?? 0),
      avgBusinessRating: bizRatings?.avg == null ? null : Math.round(Number(bizRatings.avg) * 10) / 10,
      courierRatingsCount: Number(courierRatings?.count ?? 0),
      avgCourierRating: courierRatings?.avg == null ? null : Math.round(Number(courierRatings.avg) * 10) / 10,
      lowRatedBusinesses: lowRated,
      perDay: perDay.map((r) => ({ day: String(r.day), orders: Number(r.orders), revenue: Number(r.revenue) })),
      topBusinesses: topBusinesses.map((r) => ({ id: r.id, name: r.name, orders: Number(r.orders), revenue: Number(r.revenue) })),
    };
  }),

  // --------------------------------------------------------------- Comercios
  businesses: adminQuery
    .input(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: businesses.id, name: businesses.name, category: businesses.category, address: businesses.address, pendingName: businesses.pendingName, pendingAddress: businesses.pendingAddress,
          phone: businesses.phone, emoji: businesses.emoji, approvalStatus: businesses.approvalStatus, approvalNote: businesses.approvalNote,
          lat: businesses.lat, lng: businesses.lng, locationConfirmed: businesses.locationConfirmed,
          opensAt: businesses.opensAt, closesAt: businesses.closesAt, deliveryRadiusKm: businesses.deliveryRadiusKm,
          rating: businesses.rating, ratingCount: businesses.ratingCount,
          minOrder: businesses.minOrder, deliveryFee: businesses.deliveryFee, feePerKm: businesses.feePerKm,
          ownerName: users.name, ownerEmail: users.email, createdAt: businesses.createdAt,
        })
        .from(businesses)
        .leftJoin(users, eq(users.id, businesses.ownerId))
        .where(input?.status === "pending" ? or(eq(businesses.approvalStatus, "pending"), isNotNull(businesses.pendingName), isNotNull(businesses.pendingAddress)) : input?.status ? eq(businesses.approvalStatus, input.status) : undefined)
        .orderBy(desc(businesses.createdAt));
      return rows;
    }),

  reviewBusiness: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().trim().max(300).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const biz = await db.query.businesses.findFirst({ where: eq(businesses.id, input.id) });
      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Comercio no encontrado" });
      if (input.decision === "rejected" && !input.note) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Indica el motivo del rechazo" });
      }
      if (input.decision === "approved" && !biz.locationConfirmed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El comercio aún no marcó su ubicación real en el mapa. No se puede aprobar." });
      }
      const hasPendingDetails = Boolean(biz.pendingName || biz.pendingAddress);
      if (hasPendingDetails && biz.approvalStatus === "approved") {
        await db.update(businesses).set(input.decision === "approved" ? {
          ...(biz.pendingName ? { name: biz.pendingName } : {}),
          ...(biz.pendingAddress ? { address: biz.pendingAddress } : {}),
          pendingName: null, pendingAddress: null, approvalNote: null,
        } : {
          pendingName: null, pendingAddress: null, approvalNote: null,
        }).where(eq(businesses.id, input.id));
        await sendPushToUser(biz.ownerId, input.decision === "approved"
          ? { title: "Cambios de tu comercio aprobados", body: "El nuevo nombre y/o dirección ya están publicados.", url: "/panel" }
          : { title: "Cambios de tu comercio rechazados", body: input.note!, url: "/panel" },
        ).catch((error) => console.error("Error avisando revisión al comercio:", error));
        return { ok: true, changeReview: true };
      }
      await db.update(businesses).set({
        approvalStatus: input.decision,
        approvalNote: input.decision === "rejected" ? input.note! : null,
        // Al aprobar, la ubicación actual del pin pasa a ser la ubicación aprobada (referencia para futuros movimientos).
        ...(input.decision === "approved" ? { pendingName: null, pendingAddress: null, approvedLat: biz.lat, approvedLng: biz.lng } : {}),
        ...(input.decision === "rejected" ? { isOpen: false } : {}),
      }).where(eq(businesses.id, input.id));
      await sendPushToUser(biz.ownerId, input.decision === "approved"
        ? { title: "¡Tu negocio fue aprobado! 🎉", body: `${biz.name} ya es visible para los clientes.`, url: "/panel" }
        : { title: "Tu negocio necesita cambios", body: input.note!, url: "/panel" },
      ).catch((error) => console.error("Error avisando revisión al comercio:", error));
      return { ok: true };
    }),

  // ----------------------------------------------------------------- Pedidos
  orders: adminQuery
    .input(z.object({
      status: z.enum(["pending", "accepted", "preparing", "ready", "picked_up", "delivered", "cancelled"]).optional(),
      type: z.enum(["delivery", "rescue"]).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [
        input?.status ? eq(orders.status, input.status) : undefined,
        input?.type ? eq(orders.type, input.type) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select({
          id: orders.id, code: orders.code, type: orders.type, status: orders.status, total: orders.total,
          deliveryFee: orders.deliveryFee, createdAt: orders.createdAt, readyAt: orders.readyAt, deliveredAt: orders.deliveredAt,
          cancelledBy: orders.cancelledBy, cancelReason: orders.cancelReason, courierId: orders.courierId,
          customerName: orders.customerName, customerPhone: orders.customerPhone,
          deliveryAddress: orders.deliveryAddress, deliveryDistanceKm: orders.deliveryDistanceKm,
          businessName: businesses.name,
        })
        .from(orders)
        .leftJoin(businesses, eq(businesses.id, orders.businessId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(orders.createdAt))
        .limit(input?.limit ?? 100);
      return rows;
    }),

  orderTimeline: adminQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ input }) =>
      getDb().select().from(orderEvents).where(eq(orderEvents.orderId, input.orderId)).orderBy(orderEvents.createdAt),
    ),

  // El admin puede cancelar cualquier pedido que no esté ya cerrado (con motivo obligatorio).
  cancelOrder: adminQuery
    .input(z.object({ orderId: z.number().int().positive(), reason: z.string().trim().min(5, "Indica el motivo").max(300) }))
    .mutation(async ({ ctx, input }) => {
      const order = await getDb().query.orders.findFirst({ where: eq(orders.id, input.orderId) });
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido no encontrado" });
      // El admin cancela aunque ya haya repartidor (reservado o en camino): es la salida de los reclamos
      // del tipo "mi pedido no llegó". Los demás roles sí quedan bloqueados (ver cancelOrderAndRestock).
      await cancelOrderAndRestock(order.id, [...ACTIVE_STATUSES], { by: "admin", reason: input.reason });
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "admin", type: "cancelled", detail: input.reason });
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "cancelled", type: order.type, reason: input.reason });
      // Releer: el repartidor pudo tomar el pedido entre la lectura inicial y la cancelación.
      const [after] = await getDb().select({ courierId: orders.courierId }).from(orders).where(eq(orders.id, order.id)).limit(1);
      if (after?.courierId) {
        await getDb().delete(courierLocations).where(eq(courierLocations.orderId, order.id));
        await sendPushToUser(after.courierId, { title: "Pedido cancelado por soporte", body: `El pedido ${order.code} fue cancelado: ${input.reason}`, url: "/repartidor", orderId: order.id }).catch(() => undefined);
      }
      return { ok: true };
    }),

  // ---------------------------------------------------------------- Reclamos
  claims: adminQuery
    .input(z.object({ status: z.enum(["open", "resolved", "rejected"]).optional() }).optional())
    .query(async ({ input }) =>
      getDb()
        .select({
          id: claims.id, orderId: claims.orderId, reporterRole: claims.reporterRole, reason: claims.reason,
          status: claims.status, resolution: claims.resolution, createdAt: claims.createdAt, resolvedAt: claims.resolvedAt,
          orderCode: orders.code, orderStatus: orders.status, orderTotal: orders.total,
          reporterName: users.name, reporterEmail: users.email, reporterPhone: users.phone,
        })
        .from(claims)
        .leftJoin(orders, eq(orders.id, claims.orderId))
        .leftJoin(users, eq(users.id, claims.userId))
        .where(input?.status ? eq(claims.status, input.status) : undefined)
        .orderBy(desc(claims.createdAt))
        .limit(200),
    ),

  resolveClaim: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["resolved", "rejected"]),
      resolution: z.string().trim().min(5, "Escribe una respuesta para quien reclamó").max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const claim = await db.query.claims.findFirst({ where: eq(claims.id, input.id) });
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Reclamo no encontrado" });
      // Condición atómica: dos admins no pueden resolver el mismo reclamo a la vez.
      const [res] = await db.update(claims).set({
        status: input.decision, resolution: input.resolution, resolvedBy: ctx.user.id, resolvedAt: new Date(),
      }).where(and(eq(claims.id, claim.id), eq(claims.status, "open")));
      if (res.affectedRows === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Este reclamo ya fue atendido" });
      await logOrderEvent({ orderId: claim.orderId, actorId: ctx.user.id, actorRole: "admin", type: `claim_${input.decision}`, detail: input.resolution });
      await sendPushToUser(claim.userId, { title: "Respondimos a tu reclamo", body: input.resolution.slice(0, 120), url: claim.reporterRole === "business" ? "/panel" : claim.reporterRole === "courier" ? "/repartidor" : `/pedido/${claim.orderId}`, orderId: claim.orderId })
        .catch((error) => console.error("Error avisando respuesta de reclamo:", error));
      return { ok: true };
    }),
});
