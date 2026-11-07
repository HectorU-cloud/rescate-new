import { describe, expect, it } from "vitest";
import { canCourierSeeOrder, courierCityCheck } from "./courier-city";

const MILAGRO_LOCAL = { lat: -2.134, lng: -79.594 };
const BABAHOYO_LOCAL = { lat: -1.8022, lng: -79.5344 };
const GUAYAQUIL_LOCAL = { lat: -2.1894, lng: -79.8891 };

describe("courierCityCheck (el repartidor solo trabaja en su ciudad)", () => {
  it("un repartidor de Milagro puede con un local de Milagro", () => {
    expect(courierCityCheck("milagro", MILAGRO_LOCAL)).toEqual({ ok: true });
  });
  it("no puede con un local de otra ciudad, y el mensaje dice cuál es", () => {
    const r = courierCityCheck("milagro", BABAHOYO_LOCAL);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("other-city");
      expect(r.message).toContain("Babahoyo");
    }
  });
  it("sin ciudad elegida no puede con ninguno (primero debe elegirla)", () => {
    for (const none of [null, undefined, ""]) {
      const r = courierCityCheck(none, MILAGRO_LOCAL);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("no-city");
    }
  });
  it("una ciudad guardada que ya no existe en la lista cuenta como no elegida", () => {
    const r = courierCityCheck("atlantis", MILAGRO_LOCAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-city");
  });
  it("cada ciudad ve solo lo suyo", () => {
    const locals = { milagro: MILAGRO_LOCAL, babahoyo: BABAHOYO_LOCAL, guayaquil: GUAYAQUIL_LOCAL };
    for (const [courierCity] of Object.entries(locals)) {
      for (const [localCity, point] of Object.entries(locals)) {
        expect(canCourierSeeOrder(courierCity, point), `${courierCity} ve ${localCity}`).toBe(courierCity === localCity);
      }
    }
  });
});
