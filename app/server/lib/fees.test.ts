import { describe, expect, it } from "vitest";
import { courierPayToBusiness, cutPeriodFor, ecuadorDay, summarizeDay, type ReportOrder } from "@contracts/fees";

describe("courierPayToBusiness", () => {
  it("plato de 10 + tarifa de 0,45 = el repartidor paga 10,45", () => {
    expect(courierPayToBusiness(10, 0.45)).toBe(10.45);
  });
  it("redondea a centavos sin errores de punto flotante", () => {
    expect(courierPayToBusiness(0.1 + 0.2, 0.45)).toBe(0.75);
    expect(courierPayToBusiness(7.35, 0.45)).toBe(7.8);
  });
  it("sin tarifa paga solo el pedido", () => {
    expect(courierPayToBusiness(8, 0)).toBe(8);
  });
});

describe("ecuadorDay", () => {
  it("usa la hora de Ecuador (UTC-5), no la de UTC", () => {
    expect(ecuadorDay(new Date("2026-11-13T03:30:00Z"))).toBe("2026-11-12"); // 22:30 del 12 en Ecuador
    expect(ecuadorDay(new Date("2026-11-12T05:00:00Z"))).toBe("2026-11-12"); // 00:00 en Ecuador
    expect(ecuadorDay(new Date("2026-11-12T04:59:59Z"))).toBe("2026-11-11");
  });
});

describe("cutPeriodFor (corte quincenal)", () => {
  it("del 1 al 15 y del 16 al último día del mes", () => {
    expect(cutPeriodFor(new Date("2026-11-01T12:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-15", half: 1 });
    expect(cutPeriodFor(new Date("2026-11-15T12:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-15", half: 1 });
    expect(cutPeriodFor(new Date("2026-11-16T12:00:00Z"))).toEqual({ from: "2026-11-16", to: "2026-11-30", half: 2 });
    expect(cutPeriodFor(new Date("2026-12-31T12:00:00Z"))).toEqual({ from: "2026-12-16", to: "2026-12-31", half: 2 });
  });
  it("febrero (año normal y bisiesto)", () => {
    expect(cutPeriodFor(new Date("2026-02-20T12:00:00Z")).to).toBe("2026-02-28");
    expect(cutPeriodFor(new Date("2028-02-20T12:00:00Z")).to).toBe("2028-02-29");
  });
  it("respeta el día de Ecuador en el borde de la medianoche", () => {
    // 2026-11-16 02:00 UTC = 21:00 del 15 en Ecuador → todavía es la primera quincena
    expect(cutPeriodFor(new Date("2026-11-16T02:00:00Z")).half).toBe(1);
    expect(cutPeriodFor(new Date("2026-11-16T05:00:00Z")).half).toBe(2);
  });
});

describe("summarizeDay", () => {
  const o = (over: Partial<ReportOrder>): ReportOrder => ({ code: "A", type: "delivery", fulfillmentMethod: "delivery", status: "delivered", subtotal: 10, serviceFee: 0.45, deliveryFee: 1.5, ...over });
  it("suma ventas sin envío y la tarifa que se debe; cuenta cancelados aparte", () => {
    const t = summarizeDay([o({}), o({ subtotal: 5.5 }), o({ status: "cancelled", subtotal: 99 }), o({ status: "preparing", subtotal: 50 })]);
    expect(t).toEqual({ delivered: 2, cancelled: 1, sales: 15.5, serviceFees: 0.9, deliveryFees: 3 });
  });
  it("retiro en local: hay tarifa pero no envío; rescate: ventas sin tarifa", () => {
    const t = summarizeDay([o({ fulfillmentMethod: "pickup", deliveryFee: 0 }), o({ type: "rescue", serviceFee: 0, subtotal: 4 })]);
    expect(t).toEqual({ delivered: 2, cancelled: 0, sales: 14, serviceFees: 0.45, deliveryFees: 1.5 });
  });
  it("sin pedidos todo es cero", () => {
    expect(summarizeDay([])).toEqual({ delivered: 0, cancelled: 0, sales: 0, serviceFees: 0, deliveryFees: 0 });
  });
});
