import { describe, expect, it } from "vitest";
import { GEO_FAILURE_MESSAGES, GeoError, geoFailureFromCode, getPosition } from "./geolocate";

describe("geoFailureFromCode", () => {
  it("traduce los códigos del navegador", () => {
    expect(geoFailureFromCode(1)).toBe("denied");
    expect(geoFailureFromCode(2)).toBe("unavailable");
    expect(geoFailureFromCode(3)).toBe("timeout");
  });
  it("un código desconocido se trata como 'no disponible'", () => {
    for (const code of [0, 4, -1, 99]) expect(geoFailureFromCode(code)).toBe("unavailable");
  });
});

describe("mensajes", () => {
  it("hay un mensaje para cada causa y todos invitan a elegir la ciudad a mano", () => {
    for (const reason of ["denied", "unavailable", "timeout", "unsupported"] as const) {
      expect(GEO_FAILURE_MESSAGES[reason].length).toBeGreaterThan(20);
      expect(/elige tu ciudad|elegir tu ciudad/i.test(GEO_FAILURE_MESSAGES[reason]), reason).toBe(true);
    }
  });
});

describe("getPosition", () => {
  it("sin soporte de ubicación rechaza con 'unsupported' (en pruebas no hay navegador)", async () => {
    await getPosition().then(
      () => { throw new Error("debía rechazar"); },
      (e) => { expect(e instanceof GeoError).toBe(true); expect((e as GeoError).reason).toBe("unsupported"); },
    );
  });
});
