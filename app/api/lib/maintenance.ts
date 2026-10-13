import { and, eq, isNull, lt, isNotNull } from "drizzle-orm";
import { BUSINESS_RULES } from "@contracts/constants";
import { getDb } from "../queries/connection";
import { businesses, orders } from "@db/schema";
import { cancelOrderAndRestock } from "./orders";
import { logOrderEvent } from "./order-events";
import { notifyCouriersOrderReady, notifyOrderStatus, sendPushToUser } from "./push-notifications";

const minutesAgo = (min: number) => new Date(Date.now() - min * 60_000);
let running = false;

async function cancelBySystem(order: typeof orders.$inferSelect, from: ("pending" | "ready")[], reason: string, eventType: string) {
  try {
    await cancelOrderAndRestock(order.id, from, { by: "system", reason });
  } catch {
    return false; // otro proceso ya lo cambió: no pasa nada
  }
  await logOrderEvent({ orderId: order.id, actorRole: "system", type: eventType, detail: reason });
  await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "cancelled", type: order.type, reason });
  const [biz] = await getDb().select().from(businesses).where(eq(businesses.id, order.businessId)).limit(1);
  if (biz) {
    await sendPushToUser(biz.ownerId, { title: "Pedido cancelado automáticamente", body: `${order.code}: ${reason}`, url: "/panel", orderId: order.id }).catch(() => undefined);
  }
  return true;
}

/**
 * Tiempos límite:
 *  - "listo" sin repartidor: recordatorio a los repartidores y, vencido el plazo, cancelación automática.
 *  - "pendiente" que el comercio nunca acepta: cancelación automática.
 * Es idempotente y segura de ejecutar en paralelo (las cancelaciones son atómicas).
 */
export async function sweepOrders() {
  if (running) return { cancelled: 0, reminded: 0 };
  running = true;
  let cancelled = 0;
  let reminded = 0;
  try {
    const db = getDb();

    // 1) Recordatorio a repartidores (una sola vez por pedido)
    const toRemind = await db.select().from(orders).where(and(
      eq(orders.type, "delivery"), eq(orders.status, "ready"), isNull(orders.courierId),
      isNull(orders.courierReminderSentAt), isNotNull(orders.readyAt),
      lt(orders.readyAt, minutesAgo(BUSINESS_RULES.courierReminderAfterMin)),
    ));
    for (const o of toRemind) {
      const [res] = await db.update(orders).set({ courierReminderSentAt: new Date() })
        .where(and(eq(orders.id, o.id), isNull(orders.courierReminderSentAt)));
      if (res.affectedRows === 0) continue;
      await notifyCouriersOrderReady(o.id, { reminder: true });
      reminded += 1;
    }

    // 2) Nadie tomó el pedido a tiempo
    const expiredReady = await db.select().from(orders).where(and(
      eq(orders.type, "delivery"), eq(orders.status, "ready"), isNull(orders.courierId),
      isNotNull(orders.readyAt), lt(orders.readyAt, minutesAgo(BUSINESS_RULES.courierAssignTimeoutMin)),
    ));
    for (const o of expiredReady) {
      const ok = await cancelBySystem(o, ["ready"], `Ningún repartidor tomó el pedido en ${BUSINESS_RULES.courierAssignTimeoutMin} minutos.`, "expired_no_courier");
      if (ok) cancelled += 1;
    }

    // 3) El comercio no respondió
    const expiredPending = await db.select().from(orders).where(and(
      eq(orders.status, "pending"), eq(orders.type, "delivery"),
      lt(orders.createdAt, minutesAgo(BUSINESS_RULES.businessAcceptTimeoutMin)),
    ));
    for (const o of expiredPending) {
      const ok = await cancelBySystem(o, ["pending"], `El local no respondió en ${BUSINESS_RULES.businessAcceptTimeoutMin} minutos.`, "expired_no_business");
      if (ok) cancelled += 1;
    }
  } catch (error) {
    console.error("[maintenance] Error revisando pedidos vencidos:", error);
  } finally {
    running = false;
  }
  return { cancelled, reminded };
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startMaintenance() {
  if (timer) return;
  timer = setInterval(() => { void sweepOrders(); }, 60_000);
  timer.unref?.();
  void sweepOrders();
}
