import type { WeatherCondition } from "@contracts/pricing";

/**
 * Clima actual por zona para la simulación del precio dinámico (OpenWeather, endpoint "Current weather").
 * Un resultado se reutiliza por zona unos minutos, así que el costo no crece con el número de pedidos.
 * Cualquier fallo (sin clave, error, timeout) devuelve null: la simulación simplemente no suma clima.
 */

const envTrue = (value: string | undefined) => value?.trim().toLowerCase() === "true";

/** Zona de ~5 km (0,05° ≈ 5,5 km): suficiente para una ciudad como Milagro. */
const ZONE_STEP = 0.05;
export const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
/** Un fallo también se recuerda un rato, para no insistir (ni esperar el timeout) en cada pedido. */
export const WEATHER_FAILURE_TTL_MS = 2 * 60 * 1000;

type CacheEntry = { value: WeatherCondition | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export function weatherZoneKey(lat: number, lng: number) {
  const snap = (n: number) => (Math.round(n / ZONE_STEP) * ZONE_STEP).toFixed(2);
  return `${snap(lat)},${snap(lng)}`;
}

/**
 * Códigos de condición de OpenWeather: 2xx tormenta, 3xx llovizna, 5xx lluvia.
 * Lluvia fuerte: tormenta, lluvia moderada o más, helada y chubascos intensos. El resto de lluvia/llovizna es ligera.
 */
export function classifyWeather(conditionId: number): WeatherCondition {
  if (conditionId >= 200 && conditionId < 300) return "heavy_rain";
  if (conditionId >= 300 && conditionId < 400) return "light_rain";
  if (conditionId === 500 || conditionId === 501 || conditionId === 520) return "light_rain";
  if (conditionId >= 500 && conditionId < 600) return "heavy_rain";
  return "clear";
}

/** Para pruebas: vacía la caché. */
export function clearWeatherCache() { cache.clear(); }

export async function getWeatherCondition(lat: number, lng: number, now = Date.now()): Promise<WeatherCondition | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY?.trim();
  if (!envTrue(process.env.WEATHER_ENABLED) || !apiKey) return null;

  const key = weatherZoneKey(lat, lng);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const configured = Number(process.env.WEATHER_TIMEOUT_MS ?? 3000);
  const timeoutMs = Number.isFinite(configured) ? Math.min(10000, Math.max(500, configured)) : 3000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.search = new URLSearchParams({ lat: String(lat), lon: String(lng), appid: apiKey }).toString();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { weather?: Array<{ id?: number }> };
    const ids = (data.weather ?? []).map((w) => Number(w.id)).filter((id) => Number.isFinite(id));
    if (!ids.length) throw new Error("respuesta sin condición");
    // Si hay varias condiciones, manda la más severa.
    const rank = { clear: 0, light_rain: 1, heavy_rain: 2 } as const;
    const value = ids.map(classifyWeather).reduce((worst, c) => (rank[c] > rank[worst] ? c : worst), "clear" as WeatherCondition);
    cache.set(key, { value, expiresAt: now + WEATHER_CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.error("No se pudo consultar el clima para la simulación de precio:", error instanceof Error ? error.message : error);
    cache.set(key, { value: null, expiresAt: now + WEATHER_FAILURE_TTL_MS });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
