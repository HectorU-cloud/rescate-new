import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_DELIVERIES, canCourierRelease, canCustomerCancel, hasReachedActiveLimit } from "./order-rules";

const NOW = new Date("2026-01-15T15:00:00Z");
const minutesBefore = (min: number, secs = 0) => new Date(NOW.getTime() - min * 60_000 - secs * 1000);

describe("canCustomerCancel", () => {
  it("puede cancelar mientras el local no empezó a preparar", () => {
    expect(canCustomerCancel("pending")).toBe(true);
    expect(canCustomerCancel("accepted")).toBe(true);
  });
  it("no puede cancelar desde que se prepara en adelante", () => {
    for (const s of ["preparing", "ready", "picked_up", "delivered", "cancelled"]) {
      expect(canCustomerCancel(s)).toBe(false);
    }
  });
});

describe("canCourierRelease (soltar pedido)", () => {
  it("se puede soltar recién tomado y justo en el límite de 5 min", () => {
    expect(canCourierRelease(minutesBefore(0), NOW)).toBe(true);
    expect(canCourierRelease(minutesBefore(5), NOW)).toBe(true);
  });
  it("pasados los 5 min ya no se puede", () => {
    expect(canCourierRelease(minutesBefore(5, 1), NOW)).toBe(false);
    expect(canCourierRelease(minutesBefore(30), NOW)).toBe(false);
  });
  it("sin hora de toma registrada no se puede soltar", () => {
    expect(canCourierRelease(null, NOW)).toBe(false);
    expect(canCourierRelease(undefined, NOW)).toBe(false);
  });
  it("acepta fechas en texto ISO", () => {
    expect(canCourierRelease(minutesBefore(2).toISOString(), NOW)).toBe(true);
  });
});

describe("hasReachedActiveLimit", () => {
  it("el límite es de 2 entregas activas", () => {
    expect(MAX_ACTIVE_DELIVERIES).toBe(2);
    expect(hasReachedActiveLimit(0)).toBe(false);
    expect(hasReachedActiveLimit(1)).toBe(false);
    expect(hasReachedActiveLimit(2)).toBe(true);
    expect(hasReachedActiveLimit(3)).toBe(true);
  });
});
