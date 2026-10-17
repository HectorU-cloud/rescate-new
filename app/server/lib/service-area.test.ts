import { describe, expect, it } from "vitest";
import { BUSINESS_RULES, MILAGRO } from "@contracts/constants";
import { distanceMeters, isInServiceArea } from "@contracts/geo";
import { isBusinessPublic } from "./business-rules";

describe("distanceMeters", () => {
  it("es 0 para el mismo punto y simétrica", () => {
    expect(distanceMeters(-2.134, -79.594, -2.134, -79.594)).toBeCloseTo(0, 3);
    expect(distanceMeters(-2.134, -79.594, -2.15, -79.6)).toBeCloseTo(distanceMeters(-2.15, -79.6, -2.134, -79.594), 3);
  });
  it("0.001° de latitud son ~111 m", () => {
    expect(distanceMeters(-2.134, -79.594, -2.135, -79.594)).toBeGreaterThan(105);
    expect(distanceMeters(-2.134, -79.594, -2.135, -79.594)).toBeLessThan(117);
  });
});

describe("isInServiceArea", () => {
  it("acepta el centro de Milagro y puntos de la ciudad", () => {
    expect(isInServiceArea(MILAGRO.lat, MILAGRO.lng)).toBe(true);
    expect(isInServiceArea(-2.15, -79.6)).toBe(true);
  });
  it("rechaza coordenadas absurdas o lejanas", () => {
    expect(isInServiceArea(0, 0)).toBe(false); // "isla nula"
    expect(isInServiceArea(-0.18, -78.47)).toBe(false); // Quito
    expect(isInServiceArea(-3.26, -79.96)).toBe(false); // Machala (~120 km)
  });
  it("el límite respeta el radio configurado", () => {
    const justInside = MILAGRO.lat - (BUSINESS_RULES.serviceAreaRadiusKm - 1) / 111;
    const justOutside = MILAGRO.lat - (BUSINESS_RULES.serviceAreaRadiusKm + 1) / 111;
    expect(isInServiceArea(justInside, MILAGRO.lng)).toBe(true);
    expect(isInServiceArea(justOutside, MILAGRO.lng)).toBe(false);
  });
});

describe("isBusinessPublic", () => {
  it("exige aprobación Y ubicación confirmada", () => {
    expect(isBusinessPublic({ approvalStatus: "approved", locationConfirmed: true })).toBe(true);
    expect(isBusinessPublic({ approvalStatus: "approved", locationConfirmed: false })).toBe(false);
    expect(isBusinessPublic({ approvalStatus: "pending", locationConfirmed: true })).toBe(false);
    expect(isBusinessPublic({ approvalStatus: "rejected", locationConfirmed: true })).toBe(false);
  });
});
