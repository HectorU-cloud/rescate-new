/**
 * Reglas de la tarifa de servicio de Rescate. Sin dependencias: las usan el servidor, la app y los tests.
 *
 * Modelo vigente:
 *  - El cliente paga todo (pedido + envío + tarifa de servicio).
 *  - Al recoger, el repartidor le paga al local el precio del pedido MÁS la tarifa de servicio.
 *  - El local le debe esa tarifa a Rescate y se la paga en un corte quincenal (del 1 al 15 y del 16 al fin de mes).
 */
import { BUSINESS_RULES } from "./constants";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Lo que el repartidor le paga al local al recoger: precio del pedido (sin envío) + tarifa de servicio de Rescate. */
export function courierPayToBusiness(subtotal: number, serviceFee: number): number {
  return round2(Number(subtotal) + Number(serviceFee));
}

/** Día "AAAA-MM-DD" en hora de Ecuador. */
export function ecuadorDay(date: Date = new Date(), offsetHours: number = BUSINESS_RULES.timezoneOffsetHours): string {
  return new Date(date.getTime() + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

export type CutPeriod = { from: string; to: string; half: 1 | 2 };

/** Corte quincenal que contiene a `date`: del 1 al 15 o del 16 al último día del mes (hora de Ecuador). */
export function cutPeriodFor(date: Date = new Date(), offsetHours: number = BUSINESS_RULES.timezoneOffsetHours): CutPeriod {
  const [y, m, d] = ecuadorDay(date, offsetHours).split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d <= 15) return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-15`, half: 1 };
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-16`, to: `${y}-${pad(m)}-${pad(lastDay)}`, half: 2 };
}

export type ReportOrder = {
  code: string;
  type: "delivery" | "rescue";
  fulfillmentMethod: "delivery" | "pickup";
  status: string;
  subtotal: number;
  serviceFee: number;
  deliveryFee: number;
};

export type DayTotals = {
  delivered: number;
  cancelled: number;
  /** Lo que cobra el local: subtotal de pedidos entregados. El envío no cuenta: es del repartidor. */
  sales: number;
  /** Tarifa de servicio de los pedidos a domicilio y de retiro entregados: lo que el local le debe a Rescate. */
  serviceFees: number;
  /** Informativo: envíos de los pedidos entregados (van al repartidor). */
  deliveryFees: number;
};

export function summarizeDay(rows: ReportOrder[]): DayTotals {
  let delivered = 0, cancelled = 0, sales = 0, serviceFees = 0, deliveryFees = 0;
  for (const o of rows) {
    if (o.status === "cancelled") { cancelled += 1; continue; }
    if (o.status !== "delivered") continue;
    delivered += 1;
    sales += Number(o.subtotal);
    if (o.type === "delivery") serviceFees += Number(o.serviceFee);
    if (o.fulfillmentMethod === "delivery") deliveryFees += Number(o.deliveryFee);
  }
  return { delivered, cancelled, sales: round2(sales), serviceFees: round2(serviceFees), deliveryFees: round2(deliveryFees) };
}
