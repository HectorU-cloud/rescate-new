import { describe, expect, it } from "vitest";
import type { orders } from "@db/schema";
import { redactForCourierBoard } from "./order-privacy";
import { codesMatch } from "./codes";

const order = {
  id: 7, code: "AR-ABC123", type: "delivery", status: "ready", customerId: 3, businessId: 1, courierId: null,
  subtotal: 5, deliveryFee: 1.5, total: 6.5, deliveryDistanceKm: 2.3,
  customerName: "Juan Pérez", customerPhone: "0991234567", deliveryAddress: "Av. Secreta 123 y Calle 9",
  deliveryLat: -2.139, deliveryLng: -79.588, notes: "timbre dañado, casa azul",
  deliveryConfirmationCode: "123456", pickupCode: "654321",
} as unknown as typeof orders.$inferSelect;

describe("redactForCourierBoard", () => {
  const r = redactForCourierBoard(order);

  it("no filtra nada que identifique o ubique al cliente", () => {
    expect(r.customerName).toBe("Cliente");
    expect(r.customerPhone).toBeNull();
    expect(r.deliveryAddress).toBe("");
    expect(r.deliveryLat).toBeNull();
    expect(r.deliveryLng).toBeNull();
    expect(r.notes).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/Juan|0991234567|Secreta|-2\.139|-79\.588|timbre/);
  });
  it("no filtra los códigos secretos", () => {
    expect(r.deliveryConfirmationCode).toBeNull();
    expect(r.pickupCode).toBeNull();
  });
  it("conserva lo necesario para decidir: ganancia, distancia, total a cobrar y estado", () => {
    expect(r).toMatchObject({ id: 7, code: "AR-ABC123", deliveryFee: 1.5, deliveryDistanceKm: 2.3, total: 6.5, status: "ready", businessId: 1 });
  });
  it("no modifica el pedido original", () => {
    expect(order.customerPhone).toBe("0991234567");
  });
});

describe("codesMatch", () => {
  it("acepta solo el código exacto", () => {
    expect(codesMatch("123456", "123456")).toBe(true);
    expect(codesMatch("123456", "123457")).toBe(false);
  });
  it("rechaza vacíos, nulos y longitudes distintas sin lanzar error", () => {
    expect(codesMatch(null, "123456")).toBe(false);
    expect(codesMatch(undefined, "123456")).toBe(false);
    expect(codesMatch("", "")).toBe(false);
    expect(codesMatch("123456", "12345")).toBe(false);
    expect(codesMatch("123456", "1234567")).toBe(false);
  });
});
