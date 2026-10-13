import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { orderItems, orders, rescuePacks, type OrderStatus } from "@db/schema";

/**
 * Cancela un pedido y, si traía packs de rescate, devuelve el stock.
 * Todo en una transacción y con condición atómica sobre el estado, para que
 * una doble cancelación (doble clic o cliente + comercio a la vez) no
 * devuelva el stock dos veces.
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
      .where(and(eq(orders.id, orderId), inArray(orders.status, allowedFrom)));
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
