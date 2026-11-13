import { describe, expect, it } from "vitest";
import { courierNavTarget, mapsDirectionsUrl } from "./courier-nav";

const business = { lat: -2.134, lng: -79.594 };
const customer = { deliveryLat: -2.15, deliveryLng: -79.6 };

describe("courierNavTarget (un solo botón según el estado)", () => {
  it("con el pedido todavía en el local (reservado) solo ofrece ir al local", () => {
    const t = courierNavTarget({ status: "ready", ...customer }, business);
    expect(t?.kind).toBe("business");
    expect(t?.label).toBe("🧭 Ir al local");
    expect(t?.href).toBe("https://www.google.com/maps/dir/?api=1&destination=-2.134,-79.594");
  });
  it("con el pedido ya recogido (en camino) solo ofrece ir con el cliente", () => {
    const t = courierNavTarget({ status: "picked_up", ...customer }, business);
    expect(t?.kind).toBe("customer");
    expect(t?.label).toBe("🧭 Ir con el cliente");
    expect(t?.href).toBe("https://www.google.com/maps/dir/?api=1&destination=-2.15,-79.6");
  });
  it("nunca mezcla destinos: reservado no apunta al cliente y en camino no apunta al local", () => {
    expect(courierNavTarget({ status: "ready", ...customer }, business)?.href).not.toContain("-2.15");
    expect(courierNavTarget({ status: "picked_up", ...customer }, business)?.href).not.toContain("-2.134");
  });
  it("sin coordenadas del destino no muestra botón (en vez de un enlace roto)", () => {
    expect(courierNavTarget({ status: "picked_up", deliveryLat: null, deliveryLng: null }, business)).toBeNull();
    expect(courierNavTarget({ status: "picked_up", deliveryLat: NaN, deliveryLng: -79.6 }, business)).toBeNull();
    expect(courierNavTarget({ status: "ready", ...customer }, null)).toBeNull();
    expect(courierNavTarget({ status: "ready", ...customer }, { lat: undefined, lng: -79.5 })).toBeNull();
  });
  it("un pedido entregado, cancelado o aún sin tomar no tiene botón", () => {
    for (const status of ["delivered", "cancelled", "pending", "accepted", "preparing"]) {
      expect(courierNavTarget({ status, ...customer }, business), status).toBeNull();
    }
  });
  it("mapsDirectionsUrl arma el enlace con latitud y longitud", () => {
    expect(mapsDirectionsUrl(1.5, -2.25)).toBe("https://www.google.com/maps/dir/?api=1&destination=1.5,-2.25");
  });
});
