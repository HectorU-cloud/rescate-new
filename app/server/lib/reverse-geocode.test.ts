import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGeocodeCache, formatGoogleAddress, formatNominatimAddress, formatNominatimSearch, geocodingProvider, reverseGeocode, searchAddress, searchBiasCity } from "./reverse-geocode";

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

describe("searchBiasCity", () => {
  it("sesga hacia la ciudad elegida solo si el texto no nombra ninguna de nuestras ciudades", () => {
    expect(searchBiasCity("Calle Bolívar y Rocafuerte", "milagro")?.id).toBe("milagro");
    expect(searchBiasCity("Av. Quito y Calle 5, Guayaquil", "milagro")).toBeNull();
    expect(searchBiasCity("Calle Bolívar", null)).toBeNull();
    expect(searchBiasCity("Calle Bolívar", "ciudad-inexistente")).toBeNull();
  });
});

describe("formatNominatimSearch", () => {
  it("arma la etiqueta, descarta lo que cae fuera de la zona de servicio y quita duplicados", () => {
    const out = formatNominatimSearch([
      { lat: "-2.134", lon: "-79.594", display_name: "Calle Sucre, Centro, Milagro, Guayas, 091150, Ecuador", address: { road: "Calle Sucre", suburb: "Centro", city: "Milagro" } },
      { lat: "-2.134", lon: "-79.594", display_name: "Calle Sucre, Centro, Milagro, Guayas, 091150, Ecuador", address: { road: "Calle Sucre", suburb: "Centro", city: "Milagro" } },
      { lat: "-0.18", lon: "-78.47", display_name: "Calle Sucre, Quito, Ecuador", address: { road: "Calle Sucre", city: "Quito" } },
      { lat: "-2.14", lon: "-79.6", display_name: "Escuela Rural, Los Pinos, Milagro, Guayas, 091150, Ecuador" },
    ]);
    expect(out).toEqual([
      { label: "Calle Sucre, Centro, Milagro", lat: -2.134, lng: -79.594 },
      { label: "Escuela Rural, Los Pinos, Milagro", lat: -2.14, lng: -79.6 },
    ]);
    expect(formatNominatimSearch({ error: "x" })).toEqual([]);
  });
});

describe("searchAddress", () => {
  const hit = (lat: number, lng: number, road: string, city: string) => ({ lat: String(lat), lon: String(lng), display_name: `${road}, ${city}, Ecuador`, address: { road, city } });
  const sentUrl = (fetchMock: ReturnType<typeof vi.fn>) => new URL(String(fetchMock.mock.calls[0][0]));

  it("envía el texto TAL CUAL y no le agrega la ciudad elegida cuando el cliente ya escribió otra (Guayaquil vs Milagro)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json([hit(-2.19, -79.88, "Avenida Quito", "Guayaquil")]));
    vi.stubGlobal("fetch", fetchMock);
    const out = await searchAddress("Av. Quito y Calle 5, Guayaquil", "milagro", 10_000_000);
    const url = sentUrl(fetchMock);
    expect(url.searchParams.get("q")).toBe("Av. Quito y Calle 5, Guayaquil");
    expect(url.searchParams.has("viewbox")).toBe(false);
    expect(url.searchParams.get("countrycodes")).toBe("ec");
    expect(out).toEqual([{ label: "Avenida Quito, Guayaquil", lat: -2.19, lng: -79.88 }]);
  });

  it("sin ciudad en el texto, usa la elegida solo como sesgo suave (viewbox) y deja el texto intacto", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json([hit(-2.134, -79.594, "Calle Bolívar", "Milagro")]));
    vi.stubGlobal("fetch", fetchMock);
    await searchAddress("Calle Bolívar y Rocafuerte", "milagro", 11_000_000);
    const url = sentUrl(fetchMock);
    expect(url.searchParams.get("q")).toBe("Calle Bolívar y Rocafuerte");
    expect(url.searchParams.get("bounded")).toBe("0");
    const [west, north, east, south] = url.searchParams.get("viewbox")!.split(",").map(Number);
    expect(west).toBeLessThan(-79.594);
    expect(east).toBeGreaterThan(-79.594);
    expect(south).toBeLessThan(-2.134);
    expect(north).toBeGreaterThan(-2.134);
  });

  it("sin ciudad elegida ni escrita no hay sesgo", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json([]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchAddress("Calle Bolívar y Rocafuerte", null, 12_000_000)).toEqual([]);
    expect(sentUrl(fetchMock).searchParams.has("viewbox")).toBe(false);
  });

  it("descarta resultados fuera de la zona de servicio y guarda el resultado en caché", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json([hit(-0.18, -78.47, "Calle Sucre", "Quito"), hit(-2.134, -79.594, "Calle Sucre", "Milagro")]));
    vi.stubGlobal("fetch", fetchMock);
    const t0 = 13_000_000;
    expect(await searchAddress("Calle Sucre", "milagro", t0)).toEqual([{ label: "Calle Sucre, Milagro", lat: -2.134, lng: -79.594 }]);
    expect(await searchAddress("calle  sucre", "milagro", t0 + 1000)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("apagado o con un fallo devuelve null (no se cachea); texto muy corto devuelve [] sin consultar", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("red caída")).mockImplementation(async () => json([hit(-2.134, -79.594, "Calle Sucre", "Milagro")]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchAddress("ab", "milagro", 14_000_000)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await searchAddress("Calle Sucre", "milagro", 14_000_000)).toBeNull();
    expect(await searchAddress("Calle Sucre", "milagro", 14_005_000)).toHaveLength(1);
    process.env.REVERSE_GEOCODING_ENABLED = "false";
    expect(await searchAddress("Calle Sucre", "milagro", 14_010_000)).toBeNull();
  });

  it("con Google usa address, restringe a Ecuador y solo da `bounds` si el texto no nombra otra ciudad", async () => {
    process.env.GOOGLE_GEOCODING_API_KEY = "k";
    const body = { status: "OK", results: [{ formatted_address: "Av. Quito y Calle 5, Guayaquil, Ecuador", geometry: { location: { lat: -2.19, lng: -79.88 } } }] };
    const fetchMock = vi.fn().mockImplementation(async () => json(body));
    vi.stubGlobal("fetch", fetchMock);
    const out = await searchAddress("Av. Quito y Calle 5, Guayaquil", "milagro", 15_000_000);
    const url = sentUrl(fetchMock);
    expect(url.searchParams.get("address")).toBe("Av. Quito y Calle 5, Guayaquil");
    expect(url.searchParams.get("components")).toBe("country:EC");
    expect(url.searchParams.has("bounds")).toBe(false);
    expect(out).toEqual([{ label: "Av. Quito y Calle 5, Guayaquil", lat: -2.19, lng: -79.88 }]);
    await searchAddress("Calle Bolívar y Rocafuerte", "milagro", 16_000_000);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.has("bounds")).toBe(true);
  });
});
