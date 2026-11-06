import { describe, expect, it } from "vitest";
import { buildPricingSnapshot, weatherSurcharge, type QuoteForSnapshot } from "@contracts/pricing";

describe("weatherSurcharge", () => {
  const amount = 0.5;
  it("desactivado: nunca cobra, llueva lo que llueva", () => {
    expect(weatherSurcharge({ mode: "off", amount, condition: "heavy_rain" }).fee).toBe(0);
  });
  it("modo 'heavy': solo con lluvia fuerte", () => {
    expect(weatherSurcharge({ mode: "heavy", amount, condition: "heavy_rain" }).fee).toBe(0.5);
    expect(weatherSurcharge({ mode: "heavy", amount, condition: "light_rain" }).fee).toBe(0);
    expect(weatherSurcharge({ mode: "heavy", amount, condition: "clear" }).fee).toBe(0);
  });
  it("modo 'rain': con cualquier lluvia, no con cielo despejado", () => {
    expect(weatherSurcharge({ mode: "rain", amount, condition: "light_rain" }).fee).toBe(0.5);
    expect(weatherSurcharge({ mode: "rain", amount, condition: "heavy_rain" }).fee).toBe(0.5);
    expect(weatherSurcharge({ mode: "rain", amount, condition: "clear" }).fee).toBe(0);
  });
  it("sin dato de clima NUNCA se cobra", () => {
    expect(weatherSurcharge({ mode: "rain", amount, condition: null }).fee).toBe(0);
  });
  it("un monto de 0 no cobra y el monto se redondea a centavos", () => {
    expect(weatherSurcharge({ mode: "heavy", amount: 0, condition: "heavy_rain" }).fee).toBe(0);
    expect(weatherSurcharge({ mode: "heavy", amount: 0.504, condition: "heavy_rain" }).fee).toBe(0.5);
  });
});

describe("snapshot del recargo por clima", () => {
  const quote: QuoteForSnapshot = {
    distanceKm: 3, estimatedMinutes: 9, baseFee: 0.8, perKm: 0.3, perMinute: 0.04, distanceFee: 0.9, timeFee: 0.36, rawFee: 2.06,
    clamp: "min", minFee: 1.5, maxFee: 12, fee: 2.56,
  };
  it("solo registra el recargo si se cobró", () => {
    const withoutIt = buildPricingSnapshot(quote, 0.45);
    expect("weatherFee" in withoutIt).toBe(false);
    const withIt = buildPricingSnapshot({ ...quote, weatherFee: 0.5, weatherCondition: "heavy_rain" }, 0.45);
    expect(withIt).toMatchObject({ weatherFee: 0.5, weatherCondition: "heavy_rain", deliveryFee: 2.56 });
  });
});
