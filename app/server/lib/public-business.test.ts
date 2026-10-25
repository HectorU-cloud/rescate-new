import { describe, expect, it } from "vitest";
import { HIDDEN_BUSINESS_FIELDS, toPublicBusiness } from "./public-business";
import type { Business } from "@db/schema";

const biz = {
  id: 1, ownerId: 9, name: "Pizzería", address: "Calle 1", lat: -2.1, lng: -79.5, rating: 4.5, isOpen: true,
  approvalStatus: "approved", locationConfirmed: true, approvalNote: "nota interna",
  pendingName: "Nombre nuevo", pendingAddress: "Dirección nueva", phone: "0991234567",
} as unknown as Business;

describe("toPublicBusiness", () => {
  it("quita dueño, nota interna y cambios pendientes de revisión", () => {
    const out = toPublicBusiness(biz) as Record<string, unknown>;
    for (const k of HIDDEN_BUSINESS_FIELDS) expect(k in out).toBe(false);
  });
  it("conserva todo lo que usan el catálogo, el pedido y el mapa", () => {
    const out = toPublicBusiness(biz);
    expect([out.id, out.name, out.address, out.lat, out.lng, out.rating, out.isOpen, out.phone])
      .toEqual([1, "Pizzería", "Calle 1", -2.1, -79.5, 4.5, true, "0991234567"]);
    expect([out.approvalStatus, out.locationConfirmed]).toEqual(["approved", true]); // las reglas públicas los necesitan
  });
  it("no modifica el registro original", () => {
    toPublicBusiness(biz);
    expect(biz.pendingName).toBe("Nombre nuevo");
    expect(biz.ownerId).toBe(9);
  });
});
