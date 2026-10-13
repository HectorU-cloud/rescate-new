import { getDb } from "../queries/connection";
import { orderEvents } from "@db/schema";

export type ActorRole = "customer" | "business" | "courier" | "admin" | "system";

/** Registro de auditoría. Nunca debe romper la operación principal. */
export async function logOrderEvent(args: { orderId: number; actorId?: number | null; actorRole: ActorRole; type: string; detail?: string }) {
  try {
    await getDb().insert(orderEvents).values({
      orderId: args.orderId,
      actorId: args.actorId ?? null,
      actorRole: args.actorRole,
      type: args.type,
      detail: args.detail?.slice(0, 300) ?? null,
    });
  } catch (error) {
    console.error("No se pudo registrar el evento del pedido:", error);
  }
}
