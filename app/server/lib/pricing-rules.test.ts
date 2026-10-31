import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_DELIVERY_FEE, DEFAULT_MIN_DELIVERY_FEE, PRICING_FORMULA_VERSION, buildPricingSnapshot, priceDelivery } from "@contracts/pricing";
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
