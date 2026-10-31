import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEATHER_CACHE_TTL_MS, WEATHER_FAILURE_TTL_MS, classifyWeather, clearWeatherCache, getWeatherCondition, weatherZoneKey } from "./weather";

const saved = { enabled: process.env.WEATHER_ENABLED, key: process.env.OPENWEATHER_API_KEY };
const reply = (ids: number[], status = 200) => new Response(JSON.stringify({ weather: ids.map((id) => ({ id })) }), { status });

beforeEach(() => { clearWeatherCache(); process.env.WEATHER_ENABLED = "true"; process.env.OPENWEATHER_API_KEY = "test-key"; });
afterEach(() => {
  if (saved.enabled === undefined) delete process.env.WEATHER_ENABLED; else process.env.WEATHER_ENABLED = saved.enabled;
  if (saved.key === undefined) delete process.env.OPENWEATHER_API_KEY; else process.env.OPENWEATHER_API_KEY = saved.key;
  vi.unstubAllGlobals();
});

describe("classifyWeather", () => {
  it("llovizna y lluvia ligera son ligeras; moderada, fuerte, helada y tormenta son fuertes", () => {
    expect([300, 310, 500, 501, 520].map(classifyWeather)).toEqual(Array(5).fill("light_rain"));
    expect([502, 503, 504, 511, 521, 531, 200, 211].map(classifyWeather)).toEqual(Array(8).fill("heavy_rain"));
  });
  it("nubes, sol, niebla o nieve no cuentan como lluvia", () => {
    expect([800, 801, 804, 741, 600].map(classifyWeather)).toEqual(Array(5).fill("clear"));
  });
});

describe("weatherZoneKey", () => {
  it("puntos cercanos comparten zona y puntos lejanos no", () => {
    expect(weatherZoneKey(-2.134, -79.594)).toBe(weatherZoneKey(-2.141, -79.601));
    expect(weatherZoneKey(-2.134, -79.594)).not.toBe(weatherZoneKey(-2.3, -79.594));
  });
});

describe("getWeatherCondition", () => {
  it("sin habilitar o sin clave no llama a OpenWeather", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    process.env.WEATHER_ENABLED = "false";
    expect(await getWeatherCondition(-2.134, -79.594)).toBeNull();
    process.env.WEATHER_ENABLED = "true"; process.env.OPENWEATHER_API_KEY = "";
    expect(await getWeatherCondition(-2.134, -79.594)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clasifica la respuesta y la reutiliza por zona hasta que vence la caché", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply([502])); vi.stubGlobal("fetch", fetchMock);
    const t0 = 1_000_000;
    expect(await getWeatherCondition(-2.134, -79.594, t0)).toBe("heavy_rain");
    expect(await getWeatherCondition(-2.136, -79.596, t0 + WEATHER_CACHE_TTL_MS - 1)).toBe("heavy_rain");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getWeatherCondition(-2.134, -79.594, t0 + WEATHER_CACHE_TTL_MS + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("con varias condiciones manda la más severa", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([801, 500, 503])));
    expect(await getWeatherCondition(-2.134, -79.594)).toBe("heavy_rain");
  });

  it("ante error HTTP, respuesta vacía o fallo de red devuelve null y no insiste durante un rato", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply([], 401)); vi.stubGlobal("fetch", fetchMock);
    const t0 = 5_000_000;
    expect(await getWeatherCondition(-2.134, -79.594, t0)).toBeNull();
    expect(await getWeatherCondition(-2.134, -79.594, t0 + 1000)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(reply([])); // respuesta 200 sin condiciones
    expect(await getWeatherCondition(-2.134, -79.594, t0 + WEATHER_FAILURE_TTL_MS + 1)).toBeNull();
    fetchMock.mockRejectedValue(new Error("red caída"));
    expect(await getWeatherCondition(-2.3, -79.594, t0)).toBeNull();
  });
});
