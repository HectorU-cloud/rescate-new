import { BUSINESS_RULES } from "@contracts/constants";

/** Entregas simultáneas máximas por repartidor. */
export const MAX_ACTIVE_DELIVERIES = 2;

/** ¿El cliente todavía puede cancelar un pedido en este estado? */
export function canCustomerCancel(status: string) {
  return (BUSINESS_RULES.customerCancelableStatuses as readonly string[]).includes(status);
}

/** ¿El repartidor todavía puede soltar el pedido? Solo en los primeros minutos tras tomarlo. */
export function canCourierRelease(acceptedAt: Date | string | null | undefined, now = new Date()) {
  if (!acceptedAt) return false;
  const t = new Date(acceptedAt).getTime();
  if (!t) return false;
  return now.getTime() - t <= BUSINESS_RULES.courierReleaseWindowMin * 60_000;
}

/** ¿El repartidor ya llegó al máximo de entregas activas? */
export function hasReachedActiveLimit(activeCount: number) {
  return activeCount >= MAX_ACTIVE_DELIVERIES;
}

/**
 * Estados desde los que el COMERCIO puede cancelar.
 *  - Rescate: solo antes de empezar a armar el pack (pendiente / aceptado).
 *  - Delivery: también en cocina o "listo" (sin repartidor), por si falta un ingrediente o hay un
 *    problema; una vez que el repartidor lo recoge ya no se puede cancelar.
 */
export function businessCancelableFrom(type: string): ("pending" | "accepted" | "preparing" | "ready")[] {
  return type === "delivery" ? ["pending", "accepted", "preparing", "ready"] : ["pending", "accepted"];
}

export function canBusinessCancel(type: string, status: string) {
  return (businessCancelableFrom(type) as string[]).includes(status);
}

/** Cancelar con el pedido ya en cocina o listo exige explicar el motivo (el cliente lo verá). */
export function businessCancelNeedsReason(status: string) {
  return status === "preparing" || status === "ready";
}

export const MIN_CANCEL_REASON_LENGTH = 5;
