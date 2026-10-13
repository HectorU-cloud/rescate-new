import { describe, expect, it } from "vitest";
import { shouldShowCourier, toPublicCourier } from "./courier-public";

const base = {
  name: "Carlos Andrés Pérez",
  courierPhotoUrl: "https://example.com/c.jpg",
  courierVehicle: " Moto Honda 150 ",
  courierPlate: "gab-1234",
  courierRating: 4.8,
  courierRatingCount: 12,
};

describe("toPublicCourier", () => {
  it("muestra solo el primer nombre, vehículo, placa en mayúsculas y calificación", () => {
    expect(toPublicCourier(base)).toEqual({
      name: "Carlos", photoUrl: "https://example.com/c.jpg", vehicle: "Moto Honda 150", plate: "GAB-1234", rating: 4.8, ratingCount: 12,
    });
  });
  it("no expone ningún campo extra aunque el usuario traiga más datos", () => {
    const out = toPublicCourier({ ...base, email: "x@y.com", phone: "0991234567", passwordHash: "secreto" } as typeof base);
    expect(Object.keys(out).sort()).toEqual(["name", "photoUrl", "plate", "rating", "ratingCount", "vehicle"]);
  });
  it("tolera datos faltantes", () => {
    expect(toPublicCourier({ name: null, courierPhotoUrl: null, courierVehicle: "  ", courierPlate: null, courierRating: null, courierRatingCount: 0 }))
      .toEqual({ name: null, photoUrl: null, vehicle: null, plate: null, rating: null, ratingCount: 0 });
  });
});

describe("shouldShowCourier", () => {
  it("solo en delivery, con repartidor y en camino o entregado", () => {
    expect(shouldShowCourier({ type: "delivery", status: "picked_up", courierId: 5 })).toBe(true);
    expect(shouldShowCourier({ type: "delivery", status: "delivered", courierId: 5 })).toBe(true);
  });
  it("no en otros estados, sin repartidor ni en rescates", () => {
    for (const status of ["pending", "accepted", "preparing", "ready", "cancelled"]) {
      expect(shouldShowCourier({ type: "delivery", status, courierId: 5 })).toBe(false);
    }
    expect(shouldShowCourier({ type: "delivery", status: "picked_up", courierId: null })).toBe(false);
    expect(shouldShowCourier({ type: "rescue", status: "picked_up", courierId: 5 })).toBe(false);
  });
});
