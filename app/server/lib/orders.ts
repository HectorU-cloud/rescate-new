import { randomInt } from "node:crypto";
import { and, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { courierLocations, orderItems, orders, rescuePacks, type OrderStatus } from "@db/schema";

/**
 * Cancela un pedido y, si traía packs de rescate, devuelve el stock.
 * Todo en una transacción y con condición atómica sobre el estado, para que
 * una doble cancelación (doble clic o cliente + comercio a la vez) no
 * devuelva el stock dos veces.
 *
 * Un pedido "listo" que YA tiene repartidor asignado no lo pueden cancelar el local, el cliente ni el
 * sistema (el repartidor puede estar yendo por él; si llega tarde lo libera el barrido automático).
 * Esa protección es atómica y NO aplica al admin, que debe poder cancelar cualquier pedido activo,
 * con repartidor o sin él (p. ej. un reclamo de "mi pedido no llegó").
 */
export async function cancelOrderAndRestock(
  orderId: number,
  allowedFrom: OrderStatus[],
  meta: { by?: "customer" | "business" | "admin" | "system"; reason?: string } = {},
) {
  await getDb().transaction(async (tx) => {
    const [res] = await tx
      .update(orders)
      .set({ status: "cancelled", cancelledBy: meta.by ?? null, cancelReason: meta.reason?.slice(0, 300) ?? null })
      .where(and(
        eq(orders.id, orderId),
        inArray(orders.status, allowedFrom),
        ...(meta.by === "admin" ? [] : [or(ne(orders.status, "ready"), isNull(orders.courierId))]),
      ));
    if (res.affectedRows === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Ya no se puede cancelar" });
    }
    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    for (const it of items) {
      if (!it.rescuePackId) continue;
      await tx
        .update(rescuePacks)
        .set({ quantityLeft: sql`${rescuePacks.quantityLeft} + ${it.quantity}` })
        .where(eq(rescuePacks.id, it.rescuePackId));
    }
  });
}

/**
 * Quita al repartidor de un pedido y lo deja de nuevo "listo" para que otro lo tome.
 * La condición es atómica (mismo repartidor, estado esperado y, opcionalmente, `extraWhere`), así que si el
 * repartidor justo confirma el retiro o lo suelta él mismo, solo uno de los dos caminos gana.
 * Se genera un código de retiro NUEVO: el repartidor anterior ya lo conocía o pudo intentar adivinarlo.
 * Devuelve true si el pedido se liberó.
 */
export async function releaseOrderFromCourier(
  orderId: number,
  courierId: number,
  from: ("ready" | "picked_up")[],
  extraWhere?: SQL,
) {
  const db = getDb();
  const [res] = await db.update(orders).set({
    courierId: null,
    status: "ready",
    deliveryConfirmationCode: null,
    codeAttempts: 0,
    courierAcceptedAt: null,
    courierPickupCode: String(randomInt(100000, 1000000)),
    // El plazo para que otro lo tome se reinicia.
    readyAt: new Date(),
    courierReminderSentAt: null,
  }).where(and(
    eq(orders.id, orderId),
    eq(orders.courierId, courierId),
    inArray(orders.status, from),
    ...(extraWhere ? [extraWhere] : []),
  ));
  if (res.affectedRows === 0) return false;
  await db.delete(courierLocations).where(eq(courierLocations.orderId, orderId));
  return true;
}
