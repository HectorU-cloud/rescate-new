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
  /** Solo en pedidos a domicilio creados con el modo simulación: lo que se habría sugerido cobrar. Nunca se cobra. */
  dynamicSimulation?: DynamicSimulation;
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
export function buildPricingSnapshot(quote: QuoteForSnapshot | null, serviceFee: number, simulation?: DynamicSimulation | null): DeliveryPricingSnapshot {
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
    ...(simulation ? { dynamicSimulation: simulation } : {}),
  };
}

// ---------------------------------------------------------------------------
// Precio dinámico — MODO SIMULACIÓN
// Calcula qué multiplicador se habría sugerido según tráfico, demanda y clima, y se guarda junto al pedido
// para compararlo después. NO cambia lo que se cobra: el envío cobrado sigue siendo `deliveryFee`.
// ---------------------------------------------------------------------------

/** Súbela cuando cambien los umbrales o la forma de combinarlos. */
export const DYNAMIC_SIMULATION_VERSION = 1;

export type WeatherCondition = "clear" | "light_rain" | "heavy_rain";

export const DYNAMIC_SIMULATION_RULES = {
  /** Tope del multiplicador, pase lo que pase con las señales. */
  maxMultiplier: 1.5,
  /** Tráfico: minutos con tráfico ÷ minutos sin tráfico (Google Routes). Se aplica el tramo más alto alcanzado. */
  traffic: [{ from: 1.15, add: 0.05 }, { from: 1.3, add: 0.1 }, { from: 1.5, add: 0.2 }],
  /** Demanda: pedidos a domicilio sin repartidor ÷ repartidores disponibles. */
  demand: [{ from: 1, add: 0.05 }, { from: 2, add: 0.15 }, { from: 3, add: 0.3 }],
  /** Clima (aún sin proveedor conectado: llega como null y no suma). */
  weather: { clear: 0, light_rain: 0.05, heavy_rain: 0.15 } satisfies Record<WeatherCondition, number>,
} as const;

export type DynamicSimulation = {
  version: number;
  /** Siempre false: la simulación no se cobra. Queda explícito para quien lea el registro. */
  charged: false;
  multiplier: number;
  deliveryFee: number;
  suggestedFee: number;
  extraFee: number;
  /** "multiplier": se alcanzó el tope del multiplicador; "max_fee": el envío sugerido se recortó al máximo del admin. */
  capped: "multiplier" | "max_fee" | null;
  signals: {
    traffic: { ratio: number | null; add: number };
    demand: { pressure: number | null; openOrders: number | null; availableCouriers: number | null; add: number };
    weather: { condition: WeatherCondition | null; add: number };
  };
};

const tierAdd = (tiers: ReadonlyArray<{ from: number; add: number }>, value: number | null) => {
  if (value === null || !Number.isFinite(value)) return 0;
  let add = 0;
  for (const t of tiers) if (value >= t.from) add = t.add;
  return add;
};

/**
 * Multiplicador que se habría sugerido para este envío. Si falta una señal (sin Google, sin datos de demanda,
 * sin clima) esa señal no suma, así que nunca se sugiere más por no tener datos. `maxFee` es el tope de envío del admin.
 */
export function simulateDynamicPricing(args: {
  deliveryFee: number;
  maxFee?: number | null;
  /** Minutos de la ruta con tráfico y sin tráfico; solo hay ratio si ambos vienen de Google. */
  trafficMinutes?: number | null;
  staticMinutes?: number | null;
  openOrders?: number | null;
  availableCouriers?: number | null;
  weather?: WeatherCondition | null;
}): DynamicSimulation {
  const rules = DYNAMIC_SIMULATION_RULES;
  const ratio = args.trafficMinutes && args.staticMinutes && args.trafficMinutes > 0 && args.staticMinutes > 0
    ? round2(args.trafficMinutes / args.staticMinutes) : null;
  const hasDemand = args.openOrders != null && args.availableCouriers != null && args.openOrders >= 0 && args.availableCouriers >= 0;
  const pressure = hasDemand ? round2(args.openOrders! / Math.max(1, args.availableCouriers!)) : null;
  const weather = args.weather ?? null;

  const trafficAdd = tierAdd(rules.traffic, ratio);
  const demandAdd = tierAdd(rules.demand, pressure);
  const weatherAdd = weather ? rules.weather[weather] : 0;

  let multiplier = round2(1 + trafficAdd + demandAdd + weatherAdd);
  let capped: DynamicSimulation["capped"] = null;
  if (multiplier > rules.maxMultiplier) { multiplier = rules.maxMultiplier; capped = "multiplier"; }

  let suggestedFee = round2(args.deliveryFee * multiplier);
  if (args.maxFee != null && suggestedFee > args.maxFee) {
    suggestedFee = round2(Math.max(args.maxFee, args.deliveryFee));
    capped = "max_fee";
    // El multiplicador registrado es el efectivo: así `multiplier > 1` siempre coincide con `extraFee > 0`.
    multiplier = args.deliveryFee > 0 ? round2(suggestedFee / args.deliveryFee) : 1;
  }

  return {
    version: DYNAMIC_SIMULATION_VERSION,
    charged: false,
    multiplier,
    deliveryFee: round2(args.deliveryFee),
    suggestedFee,
    extraFee: round2(suggestedFee - args.deliveryFee),
    capped,
    signals: {
      traffic: { ratio, add: trafficAdd },
      demand: { pressure, openOrders: args.openOrders ?? null, availableCouriers: args.availableCouriers ?? null, add: demandAdd },
      weather: { condition: weather, add: weatherAdd },
    },
  };
}

export type SimulationRow = {
  simulation: DynamicSimulation;
  /** Minutos reales desde que el repartidor aceptó hasta la entrega; null si el pedido no se completó. */
  realMinutes: number | null;
};

export type SimulationSummary = {
  orders: number;
  withSurge: number;
  surgeShare: number;
  avgMultiplier: number;
  avgMultiplierWhenSurge: number;
  hypotheticalExtra: number;
  cappedCount: number;
  /** Cuántos pedidos tuvieron cada señal activa (puede sumar más que `withSurge`: una orden puede tener varias). */
  bySignal: { traffic: number; demand: number; weather: number };
  /** Comparación de tiempos reales entre pedidos con y sin recargo sugerido (misma medida para ambos grupos). */
  realMinutes: { surgeAvg: number | null; normalAvg: number | null; surgeSamples: number; normalSamples: number };
};

const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Resumen para el admin: cuánto y por qué habría subido el precio, y si esos pedidos de verdad tardaron más. */
export function summarizeDynamicSimulation(rows: SimulationRow[]): SimulationSummary {
  const surge = rows.filter((r) => r.simulation.multiplier > 1);
  const normal = rows.filter((r) => r.simulation.multiplier <= 1);
  const real = (list: SimulationRow[]) => list.map((r) => r.realMinutes).filter((m): m is number => m !== null);
  const surgeReal = real(surge);
  const normalReal = real(normal);
  return {
    orders: rows.length,
    withSurge: surge.length,
    surgeShare: rows.length ? round2(surge.length / rows.length) : 0,
    avgMultiplier: avg(rows.map((r) => r.simulation.multiplier)) ?? 1,
    avgMultiplierWhenSurge: avg(surge.map((r) => r.simulation.multiplier)) ?? 1,
    hypotheticalExtra: round2(rows.reduce((sum, r) => sum + r.simulation.extraFee, 0)),
    cappedCount: rows.filter((r) => r.simulation.capped !== null).length,
    bySignal: {
      traffic: rows.filter((r) => r.simulation.signals.traffic.add > 0).length,
      demand: rows.filter((r) => r.simulation.signals.demand.add > 0).length,
      weather: rows.filter((r) => r.simulation.signals.weather.add > 0).length,
    },
    realMinutes: { surgeAvg: avg(surgeReal), normalAvg: avg(normalReal), surgeSamples: surgeReal.length, normalSamples: normalReal.length },
  };
}
