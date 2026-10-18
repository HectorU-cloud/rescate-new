import { and, count, eq, gt, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { BUSINESS_RULES } from "@contracts/constants";
import { orders, users } from "@db/schema";
import type { getDb } from "../queries/connection";

type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const IN_PROGRESS = ["pending", "accepted", "preparing", "ready", "picked_up"] as const;
const tooMany = (message: string) => new TRPCError({ code: "TOO_MANY_REQUESTS", message });

/**
 * Límites por cliente para que nadie sature a los locales con pedidos falsos o acapare packs:
 * pedidos en curso, pedidos esperando respuesta y pedidos por hora.
 * Debe llamarse DENTRO de la transacción que crea el pedido: primero bloquea la fila del cliente,
 * así dos pedidos simultáneos suyos no pueden saltarse el límite.
 */
export async function assertCustomerCanOrder(tx: Tx, customerId: number, now = new Date()) {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, customerId)).for("update");

  const [active] = await tx
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), inArray(orders.status, IN_PROGRESS)));
  if (active.n >= BUSINESS_RULES.maxActiveOrders) {
    throw tooMany(`Ya tienes ${active.n} pedidos en curso. Espera a que termine alguno antes de pedir otro.`);
  }

  const [pending] = await tx
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), eq(orders.status, "pending")));
  if (pending.n >= BUSINESS_RULES.maxPendingOrders) {
    throw tooMany(`Tienes ${pending.n} pedidos esperando respuesta de los locales. Espera a que los acepten o cancela alguno.`);
  }

  const [lastHour] = await tx
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), gt(orders.createdAt, new Date(now.getTime() - 60 * 60 * 1000))));
  if (lastHour.n >= BUSINESS_RULES.maxOrdersPerHour) {
    throw tooMany("Hiciste muchos pedidos en la última hora. Inténtalo de nuevo más tarde.");
  }
}
