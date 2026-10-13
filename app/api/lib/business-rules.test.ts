import { describe, expect, it } from "vitest";
import { haversineKm, isBusinessOpenNow, isWithinHours, quoteDelivery } from "./business-rules";

// Ecuador = UTC-5: 15:00 UTC son las 10:00 en Milagro.
const at = (utcHour: number, utcMin = 0) => new Date(Date.UTC(2026, 0, 15, utcHour, utcMin));

const biz = { lat: -2.134, lng: -79.594, deliveryFee: 1, feePerKm: 0.5, deliveryRadiusKm: 3, minOrder: 5 };

describe("haversineKm", () => {
  it("es 0 para el mismo punto", () => {
    expect(haversineKm(-2.134, -79.594, -2.134, -79.594)).toBeCloseTo(0, 5);
  });
  it("1 grado de latitud ≈ 111 km", () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });
});

describe("quoteDelivery", () => {
  it("tarifa = base + costo por km × distancia (con factor de calles)", () => {
    // ~1.11 km en línea recta → ×1.3 ≈ 1.4 km
    const q = quoteDelivery(biz, -2.134 + 0.01, -79.594);
    expect(q.distanceKm).toBeCloseTo(1.4, 1);
    expect(q.fee).toBeCloseTo(1 + 0.5 * q.distanceKm, 2);
    expect(q.withinRadius).toBe(true);
    expect(q.minOrder).toBe(5);
  });
  it("marca fuera de radio cuando supera el límite", () => {
    const q = quoteDelivery(biz, -2.134 + 0.05, -79.594); // ~7 km por calles
    expect(q.withinRadius).toBe(false);
  });
  it("en el mismo punto cobra solo la tarifa base", () => {
    expect(quoteDelivery(biz, biz.lat, biz.lng).fee).toBe(1);
  });
});

describe("horarios", () => {
  it("dentro y fuera de un horario normal", () => {
    expect(isWithinHours("08:00", "22:00", at(15))).toBe(true); // 10:00
    expect(isWithinHours("08:00", "22:00", at(2))).toBe(true); // 21:00 EC: aún abierto
    expect(isWithinHours("08:00", "22:00", at(4))).toBe(false); // 23:00 EC: cerrado
  });
  it("07:59 está cerrado y 08:00 abierto", () => {
    expect(isWithinHours("08:00", "22:00", at(12, 59))).toBe(false); // 07:59
    expect(isWithinHours("08:00", "22:00", at(13, 0))).toBe(true); // 08:00
  });
  it("la hora de cierre ya no está abierta", () => {
    expect(isWithinHours("08:00", "22:00", at(3, 0))).toBe(false); // 22:00
  });
  it("horario que cruza la medianoche", () => {
    expect(isWithinHours("18:00", "02:00", at(4, 0))).toBe(true); // 23:00
    expect(isWithinHours("18:00", "02:00", at(6, 0))).toBe(true); // 01:00
    expect(isWithinHours("18:00", "02:00", at(15, 0))).toBe(false); // 10:00
  });
  it("apertura = cierre significa 24 horas", () => {
    expect(isWithinHours("00:00", "00:00", at(9))).toBe(true);
  });
  it("cerrado manualmente aunque esté en horario", () => {
    expect(isBusinessOpenNow({ isOpen: false, opensAt: "08:00", closesAt: "22:00" }, at(15))).toBe(false);
    expect(isBusinessOpenNow({ isOpen: true, opensAt: "08:00", closesAt: "22:00" }, at(15))).toBe(true);
  });
});
