import { describe, expect, it } from "vitest";
import { bayesianRating, haversineKm, isBusinessOpenNow, isPackReservable, isWithinHours, quoteDelivery } from "./business-rules";

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

describe("isPackReservable (ventana de retiro)", () => {
  it("se puede reservar antes de que empiece la ventana", () => {
    expect(isPackReservable("19:00", "20:30", at(15))).toBe(true); // 10:00
    expect(isPackReservable("19:00", "20:30", at(23, 59))).toBe(true); // 18:59
  });
  it("se puede reservar durante la ventana", () => {
    expect(isPackReservable("19:00", "20:30", at(1, 0))).toBe(true); // 20:00 EC
  });
  it("20:29 aún se puede y 20:30 ya no", () => {
    expect(isPackReservable("19:00", "20:30", at(1, 29))).toBe(true); // 20:29
    expect(isPackReservable("19:00", "20:30", at(1, 30))).toBe(false); // 20:30
  });
  it("después del fin de la ventana se bloquea", () => {
    expect(isPackReservable("19:00", "20:30", at(3, 0))).toBe(false); // 22:00
  });
  it("ventana que cruza la medianoche (22:00–01:00)", () => {
    expect(isPackReservable("22:00", "01:00", at(15))).toBe(false); // 10:00: hueco entre el fin y el inicio
    expect(isPackReservable("22:00", "01:00", at(3, 0))).toBe(true); // 22:00, inicio de la ventana
    expect(isPackReservable("22:00", "01:00", at(4, 0))).toBe(true); // 23:00, dentro
    expect(isPackReservable("22:00", "01:00", at(5, 59))).toBe(true); // 00:59, dentro
    expect(isPackReservable("22:00", "01:00", at(6, 0))).toBe(false); // 01:00, terminó
    expect(isPackReservable("22:00", "01:00", at(10, 0))).toBe(false); // 05:00, hueco
  });
  it("inicio = fin significa todo el día", () => {
    expect(isPackReservable("00:00", "00:00", at(9))).toBe(true);
  });
});

describe("bayesianRating", () => {
  it("sin calificaciones vale el valor inicial (4.5)", () => {
    expect(bayesianRating(0, 0)).toBe(4.5);
  });
  it("una sola calificación apenas mueve el promedio", () => {
    expect(bayesianRating(5, 1)).toBe(4.58);
    expect(bayesianRating(1, 1)).toBe(3.92);
  });
  it("con muchas calificaciones converge al promedio real", () => {
    expect(bayesianRating(500, 100)).toBe(4.98); // cien de 5★
    expect(bayesianRating(100, 100)).toBe(1.17); // cien de 1★
  });
});
