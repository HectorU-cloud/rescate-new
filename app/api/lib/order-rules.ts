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
