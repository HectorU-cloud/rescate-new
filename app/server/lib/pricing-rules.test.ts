import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_DELIVERY_FEE, DEFAULT_MIN_DELIVERY_FEE, DYNAMIC_SIMULATION_RULES, PRICING_FORMULA_VERSION, buildPricingSnapshot, priceDelivery, simulateDynamicPricing, summarizeDynamicSimulation } from "@contracts/pricing";
import { deliveryRates, quoteDelivery } from "./business-rules";

const base = { baseFee: 0.8, perKm: 0.3, perMinute: 0.04 };

describe("priceDelivery", () => {
  it("suma base + distancia + tiempo y redondea cada componente", () => {
    expect(priceDelivery({ ...base, distanceKm: 4.2, minutes: 13 })).toEqual({ baseFee: 0.8, distanceFee: 1.26, timeFee: 0.52, rawFee: 2.58, fee: 2.58, clamp: null });
  });
  it("sin topes no acota el resultado", () => {
    expect(priceDelivery({ ...base, distanceKm: 100, minutes: 200 })).toMatchObject({ fee: 38.8, clamp: null });
  });
  it("el mínimo sube el envío y lo deja registrado, conservando la suma original", () => {
    expect(priceDelivery({ ...base, distanceKm: 0.3, minutes: 1, minFee: 1.5, maxFee: 12 })).toMatchObject({ rawFee: 0.93, fee: 1.5, clamp: "min" });
  });
  it("el máximo baja el envío y lo deja registrado", () => {
    expect(priceDelivery({ ...base, distanceKm: 60, minutes: 120, minFee: 1.5, maxFee: 12 })).toMatchObject({ rawFee: 23.6, fee: 12, clamp: "max" });
  });
  it("justo en el tope no cuenta como acotado", () => {
    expect(priceDelivery({ baseFee: 1.5, perKm: 0, perMinute: 0, distanceKm: 3, minutes: 9, minFee: 1.5, maxFee: 12 })).toMatchObject({ fee: 1.5, clamp: null });
    expect(priceDelivery({ baseFee: 12, perKm: 0, perMinute: 0, distanceKm: 3, minutes: 9, minFee: 1.5, maxFee: 12 })).toMatchObject({ fee: 12, clamp: null });
  });
  it("no acumula errores de coma flotante", () => {
    expect(priceDelivery({ baseFee: 0.1, perKm: 0.2, perMinute: 0, distanceKm: 1, minutes: 0 }).fee).toBe(0.3);
  });
});

describe("deliveryRates", () => {
  const local = { deliveryFee: 1, feePerKm: 0.5 };
  it("sin configuración del admin usa las tarifas del local y no pone topes (como antes)", () => {
    expect(deliveryRates(local)).toEqual({ baseFee: 1, perKm: 0.5, perMinute: 0 });
  });
  it("con configuración usa sus tarifas y topes", () => {
    expect(deliveryRates(local, { ...base, minFee: 2, maxFee: 9 })).toEqual({ ...base, minFee: 2, maxFee: 9 });
  });
  it("si faltan los topes usa los de respaldo", () => {
    expect(deliveryRates(local, base)).toMatchObject({ minFee: DEFAULT_MIN_DELIVERY_FEE, maxFee: DEFAULT_MAX_DELIVERY_FEE });
  });
});

describe("buildPricingSnapshot", () => {
  const business = { lat: -2.134, lng: -79.594, deliveryFee: 1, feePerKm: 0.5, deliveryRadiusKm: 8, minOrder: 0 };

  it("un retiro en local solo registra que no hubo envío y la tarifa de servicio", () => {
    expect(buildPricingSnapshot(null, 0.45)).toEqual({
      formulaVersion: PRICING_FORMULA_VERSION, fulfillment: "pickup", provider: null, distanceKm: null, minutes: null,
      baseFee: null, perKm: null, perMinute: null, distanceFee: null, timeFee: null, rawFee: null,
      minFee: null, maxFee: null, clamp: null, deliveryFee: 0, serviceFee: 0.45,
    });
  });

  it("un envío registra distancia, tiempo, tarifas, topes y el importe cobrado", () => {
    const quote = { ...quoteDelivery(business, -2.139, -79.588, { ...base, minFee: 4, maxFee: 9 }), routeProvider: "fallback" as const };
    const snap = buildPricingSnapshot(quote, 0.77);
    expect(snap).toMatchObject({
      fulfillment: "delivery", provider: "fallback", perKm: 0.3, perMinute: 0.04, minFee: 4, maxFee: 9,
      clamp: "min", deliveryFee: 4, serviceFee: 0.77, formulaVersion: PRICING_FORMULA_VERSION,
    });
    expect(snap.distanceKm).toBe(quote.distanceKm);
    expect(snap.minutes).toBe(quote.estimatedMinutes);
    // lo registrado alcanza para reconstruir el cálculo
    expect(snap.rawFee!).toBeLessThan(4);
    expect(Math.abs(snap.baseFee! + snap.distanceFee! + snap.timeFee! - snap.rawFee!)).toBeLessThan(0.02);
  });

  it("sin topes de configuración (admin sin guardar) no registra topes", () => {
    const quote = quoteDelivery(business, -2.139, -79.588);
    expect(buildPricingSnapshot(quote, 0.45)).toMatchObject({ minFee: null, maxFee: null, clamp: null, perMinute: 0, perKm: 0.5 });
  });
});

describe("simulateDynamicPricing", () => {
  it("sin ninguna señal el multiplicador es 1 y no sugiere nada extra", () => {
    expect(simulateDynamicPricing({ deliveryFee: 2.5 })).toMatchObject({ multiplier: 1, suggestedFee: 2.5, extraFee: 0, capped: null, charged: false });
  });
  it("tráfico: usa el tramo más alto alcanzado y registra el cociente", () => {
    const sim = simulateDynamicPricing({ deliveryFee: 2, trafficMinutes: 20, staticMinutes: 15 }); // 1.33
    expect(sim.signals.traffic).toEqual({ ratio: 1.33, add: 0.1 });
    expect(sim).toMatchObject({ multiplier: 1.1, suggestedFee: 2.2, extraFee: 0.2 });
  });
  it("tráfico por debajo del primer tramo no suma", () => {
    expect(simulateDynamicPricing({ deliveryFee: 2, trafficMinutes: 14, staticMinutes: 13 }).signals.traffic.add).toBe(0);
  });
  it("demanda: pedidos sin repartidor entre repartidores disponibles; con 0 repartidores no divide por cero", () => {
    expect(simulateDynamicPricing({ deliveryFee: 2, openOrders: 4, availableCouriers: 2 }).signals.demand).toMatchObject({ pressure: 2, add: 0.15 });
    expect(simulateDynamicPricing({ deliveryFee: 2, openOrders: 3, availableCouriers: 0 }).signals.demand).toMatchObject({ pressure: 3, add: 0.3 });
  });
  it("si falta la demanda (consulta fallida) esa señal no suma", () => {
    expect(simulateDynamicPricing({ deliveryFee: 2, openOrders: null, availableCouriers: null }).signals.demand).toMatchObject({ pressure: null, add: 0 });
  });
  it("las señales se suman y el multiplicador nunca pasa del tope", () => {
    const sim = simulateDynamicPricing({ deliveryFee: 2.5, trafficMinutes: 30, staticMinutes: 15, openOrders: 9, availableCouriers: 1, weather: "heavy_rain" });
    expect(sim.multiplier).toBe(DYNAMIC_SIMULATION_RULES.maxMultiplier);
    expect(sim).toMatchObject({ suggestedFee: 3.75, capped: "multiplier" });
  });
  it("el envío sugerido no pasa del máximo del admin y el multiplicador registrado es el efectivo", () => {
    const sim = simulateDynamicPricing({ deliveryFee: 11, maxFee: 12, openOrders: 9, availableCouriers: 1 });
    expect(sim).toMatchObject({ suggestedFee: 12, extraFee: 1, capped: "max_fee", multiplier: 1.09 });
  });
  it("si el envío ya está en el máximo no sugiere extra", () => {
    expect(simulateDynamicPricing({ deliveryFee: 12, maxFee: 12, openOrders: 9, availableCouriers: 1 })).toMatchObject({ suggestedFee: 12, extraFee: 0, multiplier: 1 });
  });
  it("el snapshot solo incluye la simulación cuando se pasa, sin tocar lo cobrado", () => {
    const quote = { ...quoteDelivery({ lat: -2.134, lng: -79.594, deliveryFee: 1, feePerKm: 0.5, deliveryRadiusKm: 8, minOrder: 0 }, -2.139, -79.588, base), routeProvider: "fallback" as const };
    const sim = simulateDynamicPricing({ deliveryFee: quote.fee, openOrders: 4, availableCouriers: 1 });
    const withSim = buildPricingSnapshot(quote, 0.45, sim);
    expect(withSim.dynamicSimulation).toEqual(sim);
    expect(withSim.deliveryFee).toBe(quote.fee);
    expect("dynamicSimulation" in buildPricingSnapshot(quote, 0.45)).toBe(false);
    expect("dynamicSimulation" in buildPricingSnapshot(null, 0.45, null)).toBe(false);
  });
});

describe("summarizeDynamicSimulation", () => {
  const calm = simulateDynamicPricing({ deliveryFee: 2 });
  const busy = simulateDynamicPricing({ deliveryFee: 2, openOrders: 4, availableCouriers: 1 }); // 1.3 → +0.30 → x1.3
  it("sin pedidos devuelve ceros sin dividir por cero", () => {
    expect(summarizeDynamicSimulation([])).toMatchObject({ orders: 0, withSurge: 0, surgeShare: 0, avgMultiplier: 1, hypotheticalExtra: 0 });
  });
  it("cuenta recargos, ingreso hipotético y compara tiempos reales entre grupos", () => {
    const sum = summarizeDynamicSimulation([
      { simulation: calm, realMinutes: 20 }, { simulation: calm, realMinutes: 30 },
      { simulation: busy, realMinutes: 40 }, { simulation: busy, realMinutes: null },
    ]);
    expect(sum).toMatchObject({ orders: 4, withSurge: 2, surgeShare: 0.5, avgMultiplierWhenSurge: busy.multiplier });
    expect(sum.hypotheticalExtra).toBeCloseTo(busy.extraFee * 2, 2);
    expect(sum.bySignal).toEqual({ traffic: 0, demand: 2, weather: 0 });
    expect(sum.realMinutes).toEqual({ surgeAvg: 40, normalAvg: 25, surgeSamples: 1, normalSamples: 2 });
  });
});
