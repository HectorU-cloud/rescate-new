import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGeocodeCache, formatGoogleAddress, formatNominatimAddress, geocodingProvider, reverseGeocode } from "./reverse-geocode";

const MILAGRO = { lat: -2.134, lng: -79.594 };
const saved = { enabled: process.env.REVERSE_GEOCODING_ENABLED, google: process.env.GOOGLE_GEOCODING_API_KEY };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { clearGeocodeCache(); delete process.env.REVERSE_GEOCODING_ENABLED; delete process.env.GOOGLE_GEOCODING_API_KEY; });
afterEach(() => {
  if (saved.enabled === undefined) delete process.env.REVERSE_GEOCODING_ENABLED; else process.env.REVERSE_GEOCODING_ENABLED = saved.enabled;
  if (saved.google === undefined) delete process.env.GOOGLE_GEOCODING_API_KEY; else process.env.GOOGLE_GEOCODING_API_KEY = saved.google;
  vi.unstubAllGlobals();
});

describe("formatNominatimAddress", () => {
  it("arma calle + número, barrio y ciudad sin repetir", () => {
    expect(formatNominatimAddress({ address: { road: "Avenida 9 de Octubre", house_number: "123", suburb: "Centro", city: "Milagro" } })).toBe("Avenida 9 de Octubre 123, Centro, Milagro");
    expect(formatNominatimAddress({ address: { road: "Calle Bolívar", neighbourhood: "Milagro", town: "Milagro" } })).toBe("Calle Bolívar, Milagro");
  });
  it("sin calle ni barrio (solo la ciudad) no sugiere nada", () => {
    expect(formatNominatimAddress({ address: { city: "Milagro", state: "Guayas" } })).toBeNull();
    expect(formatNominatimAddress({})).toBeNull();
    expect(formatNominatimAddress(null)).toBeNull();
  });
});

describe("formatGoogleAddress", () => {
  it("quita el país y salta los plus codes", () => {
    expect(formatGoogleAddress({ status: "OK", results: [{ formatted_address: "7PPW+X9 Milagro, Ecuador" }, { formatted_address: "Av. Chile y Calle 5, Milagro, Ecuador" }] })).toBe("Av. Chile y Calle 5, Milagro");
  });
  it("sin resultados o con error devuelve null", () => {
    expect(formatGoogleAddress({ status: "ZERO_RESULTS", results: [] })).toBeNull();
    expect(formatGoogleAddress({ status: "REQUEST_DENIED" })).toBeNull();
  });
});

describe("reverseGeocode", () => {
  it("elige proveedor por entorno y se puede apagar", () => {
    expect(geocodingProvider()).toBe("nominatim");
    process.env.GOOGLE_GEOCODING_API_KEY = "k";
    expect(geocodingProvider()).toBe("google");
    process.env.REVERSE_GEOCODING_ENABLED = "false";
    expect(geocodingProvider()).toBeNull();
  });

  it("apagado o fuera de la zona de servicio no llama a ningún proveedor", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await reverseGeocode(40.7, -74.0)).toBeNull(); // Nueva York
    process.env.REVERSE_GEOCODING_ENABLED = "false";
    expect(await reverseGeocode(MILAGRO.lat, MILAGRO.lng)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consulta Nominatim con User-Agent y guarda el resultado en caché", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ address: { road: "Calle Rocafuerte", suburb: "Centro", city: "Milagro" } }));
    vi.stubGlobal("fetch", fetchMock);
    const t0 = 1_000_000;
    expect(await reverseGeocode(MILAGRO.lat, MILAGRO.lng, t0)).toEqual({ address: "Calle Rocafuerte, Centro, Milagro" });
    expect(await reverseGeocode(MILAGRO.lat, MILAGRO.lng, t0 + 1000)).toEqual({ address: "Calle Rocafuerte, Centro, Milagro" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["User-Agent"]).toContain("AlRescate");
  });

  it("un fallo devuelve null y no se cachea (se puede reintentar)", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("red caída")).mockImplementation(async () => json({ address: { road: "Calle Sucre", suburb: "Centro" } }));
    vi.stubGlobal("fetch", fetchMock);
    const t0 = 5_000_000;
    expect(await reverseGeocode(MILAGRO.lat, MILAGRO.lng, t0)).toBeNull();
    expect(await reverseGeocode(MILAGRO.lat, MILAGRO.lng, t0 + 5000)).toEqual({ address: "Calle Sucre, Centro" });
  });
});
