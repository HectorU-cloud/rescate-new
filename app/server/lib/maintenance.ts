import { and, eq, inArray, isNull, lt, isNotNull, or } from "drizzle-orm";
import { BUSINESS_RULES } from "@contracts/constants";
import { getDb } from "../queries/connection";
import { businesses, orders, type OrderStatus } from "@db/schema";
import { cancelOrderAndRestock, releaseOrderFromCourier } from "./orders";
import { logOrderEvent } from "./order-events";
import { notifyBusinessStalled, notifyCouriersOrderReady, notifyOrderStatus, sendPushToUser } from "./push-notifications";

const minutesAgo = (min: number) => new Date(Date.now() - min * 60_000);
let running = false;

async function cancelBySystem(order: typeof orders.$inferSelect, from: OrderStatus[], reason: string, eventType: string) {
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
 *  - delivery "aceptado"/"en preparación" que el comercio no avanza: recordatorio y, vencido el plazo, cancelación.
 *    (Los rescates quedan fuera: esperan al cliente dentro de su ventana de retiro.)
 *  - "listo" con repartidor que reservó pero nunca confirma el retiro: se libera la reserva y se busca otro.
 * Es idempotente y segura de ejecutar en paralelo (las cancelaciones son atómicas).
 */
export async function sweepOrders() {
  if (running) return { cancelled: 0, reminded: 0, businessReminded: 0, released: 0 };
  running = true;
  let cancelled = 0;
  let reminded = 0;
  let businessReminded = 0;
  let released = 0;
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

    // 4) Delivery aceptado / en cocina que no avanza: recordatorio al comercio y luego cancelación
    const stalled = await db.select().from(orders).where(and(
      eq(orders.type, "delivery"), inArray(orders.status, ["accepted", "preparing"]),
      lt(orders.updatedAt, minutesAgo(BUSINESS_RULES.businessProgressReminderMin)),
    ));
    for (const o of stalled) {
      const idleMin = Math.floor((Date.now() - new Date(o.updatedAt).getTime()) / 60_000);
      if (idleMin >= BUSINESS_RULES.businessProgressTimeoutMin) {
        const ok = await cancelBySystem(o, ["accepted", "preparing"], `El local no avanzó con tu pedido en ${BUSINESS_RULES.businessProgressTimeoutMin} minutos.`, "expired_stalled");
        if (ok) cancelled += 1;
        continue;
      }
      if (o.businessReminderSentAt) continue;
      // Se conserva updatedAt: si no, marcar el recordatorio reiniciaría el reloj de cancelación.
      const [res] = await db.update(orders).set({ businessReminderSentAt: new Date(), updatedAt: o.updatedAt })
        .where(and(eq(orders.id, o.id), eq(orders.status, o.status), isNull(orders.businessReminderSentAt)));
      if (res.affectedRows === 0) continue;
      await notifyBusinessStalled({ orderId: o.id, code: o.code, businessId: o.businessId, status: o.status, idleMin, timeoutMin: BUSINESS_RULES.businessProgressTimeoutMin });
      businessReminded += 1;
    }

    // 5) Repartidor que reservó el pedido y nunca confirma el retiro: se le quita la reserva.
    //    Sin esto el pedido quedaba "listo" con repartidor para siempre y ocupaba cupo del cliente
    //    (pedidos en curso) y del repartidor (entregas activas). Se avisa a todos los involucrados.
    const cutoff = minutesAgo(BUSINESS_RULES.courierPickupTimeoutMin);
    const reservationStale = or(
      lt(orders.courierAcceptedAt, cutoff),
      // Reservas antiguas sin hora de toma: se usa la última modificación del pedido.
      and(isNull(orders.courierAcceptedAt), lt(orders.updatedAt, cutoff)),
    );
    const stale = await db.select().from(orders).where(and(
      eq(orders.type, "delivery"), eq(orders.status, "ready"), isNotNull(orders.courierId), reservationStale,
    ));
    for (const o of stale) {
      const courierId = o.courierId!;
      const ok = await releaseOrderFromCourier(o.id, courierId, ["ready"], reservationStale);
      if (!ok) continue; // el repartidor justo confirmó el retiro o lo soltó: no pasa nada
      released += 1;
      await logOrderEvent({ orderId: o.id, actorId: courierId, actorRole: "system", type: "courier_no_show", detail: `No confirmó el retiro en ${BUSINESS_RULES.courierPickupTimeoutMin} minutos.` });
      await sendPushToUser(courierId, { title: "Reserva liberada ⏱️", body: `Liberamos el pedido ${o.code} porque no confirmaste el retiro en ${BUSINESS_RULES.courierPickupTimeoutMin} minutos.`, url: "/repartidor", orderId: o.id }).catch(() => undefined);
      await sendPushToUser(o.customerId, { title: "Buscamos otro repartidor 🛵", body: `El repartidor de tu pedido ${o.code} no llegó al local. Estamos asignando otro.`, orderId: o.id }).catch(() => undefined);
      const [biz] = await db.select().from(businesses).where(eq(businesses.id, o.businessId)).limit(1);
      if (biz) await sendPushToUser(biz.ownerId, { title: "El repartidor no llegó", body: `El pedido ${o.code} sigue listo y buscamos otro repartidor. El código de retiro cambió.`, url: "/panel", orderId: o.id }).catch(() => undefined);
      await notifyCouriersOrderReady(o.id);
    }
  } catch (error) {
    console.error("[maintenance] Error revisando pedidos vencidos:", error);
  } finally {
    running = false;
  }
  return { cancelled, reminded, businessReminded, released };
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startMaintenance() {
  if (timer) return;
  timer = setInterval(() => { void sweepOrders(); }, 60_000);
  timer.unref?.();
  void sweepOrders();
}
