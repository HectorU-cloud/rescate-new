/**
 * Fórmula del precio de entrega y registro de cómo se calculó cada pedido. Sin dependencias: la usan el
 * servidor (cotiza y guarda) y los tests. El importe final siempre lo calcula el servidor.
 */

/** Súbela cuando cambie la fórmula, para saber con qué regla se calculó un pedido antiguo. */
export const PRICING_FORMULA_VERSION = 1;

// Valores de respaldo: solo se usan si el admin aún no guardó la configuración de tarifas.
export const DEFAULT_SERVICE_FEE = 0.45;
export const DEFAULT_MIN_DELIVERY_FEE = 1.5;
export const DEFAULT_MAX_DELIVERY_FEE = 12;

export type FeeClamp = "min" | "max" | null;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Envío = base + precio por km × distancia + precio por minuto × tiempo, acotado entre `minFee` y `maxFee`
 * (si no se indican, no se acota). `clamp` dice si el tope mínimo o máximo cambió el resultado.
 */
export function priceDelivery(args: { baseFee: number; perKm: number; perMinute: number; distanceKm: number; minutes: number; minFee?: number; maxFee?: number }) {
  const distanceFee = args.perKm * args.distanceKm;
  const timeFee = args.perMinute * args.minutes;
  const raw = args.baseFee + distanceFee + timeFee;
  let fee = raw;
  let clamp: FeeClamp = null;
  if (args.maxFee !== undefined && raw > args.maxFee) { fee = args.maxFee; clamp = "max"; }
  else if (args.minFee !== undefined && raw < args.minFee) { fee = args.minFee; clamp = "min"; }
  return {
    baseFee: round2(args.baseFee),
    distanceFee: round2(distanceFee),
    timeFee: round2(timeFee),
    rawFee: round2(raw),
    fee: round2(fee),
    clamp,
  };
}

/** Lo que se guarda en el pedido: con qué datos y reglas se calculó lo que aceptó el cliente. */
export type DeliveryPricingSnapshot = {
  formulaVersion: number;
  fulfillment: "delivery" | "pickup";
  provider: "google" | "fallback" | null;
  distanceKm: number | null;
  minutes: number | null;
  baseFee: number | null;
  perKm: number | null;
  perMinute: number | null;
  distanceFee: number | null;
  timeFee: number | null;
  rawFee: number | null;
  minFee: number | null;
  maxFee: number | null;
  clamp: FeeClamp;
  deliveryFee: number;
  serviceFee: number;
};

export type QuoteForSnapshot = {
  distanceKm: number;
  estimatedMinutes: number;
  baseFee: number;
  perKm: number;
  perMinute: number;
  distanceFee: number;
  timeFee: number;
  rawFee: number;
  minFee?: number;
  maxFee?: number;
  clamp: FeeClamp;
  fee: number;
  routeProvider?: "google" | "fallback";
};

/** Registro del cálculo de un pedido. Sin cotización (retiro en local) solo guarda que no hubo envío y la tarifa de servicio. */
export function buildPricingSnapshot(quote: QuoteForSnapshot | null, serviceFee: number): DeliveryPricingSnapshot {
  if (!quote) {
    return {
      formulaVersion: PRICING_FORMULA_VERSION, fulfillment: "pickup", provider: null, distanceKm: null, minutes: null,
      baseFee: null, perKm: null, perMinute: null, distanceFee: null, timeFee: null, rawFee: null,
      minFee: null, maxFee: null, clamp: null, deliveryFee: 0, serviceFee: round2(serviceFee),
    };
  }
  return {
    formulaVersion: PRICING_FORMULA_VERSION,
    fulfillment: "delivery",
    provider: quote.routeProvider ?? null,
    distanceKm: quote.distanceKm,
    minutes: quote.estimatedMinutes,
    baseFee: quote.baseFee,
    perKm: quote.perKm,
    perMinute: quote.perMinute,
    distanceFee: quote.distanceFee,
    timeFee: quote.timeFee,
    rawFee: quote.rawFee,
    minFee: quote.minFee ?? null,
    maxFee: quote.maxFee ?? null,
    clamp: quote.clamp,
    deliveryFee: quote.fee,
    serviceFee: round2(serviceFee),
  };
}
