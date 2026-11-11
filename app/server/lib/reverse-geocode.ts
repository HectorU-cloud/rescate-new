import { isInServiceArea } from "@contracts/geo";

/**
 * De coordenadas a dirección escrita («Av. 9 de Octubre 123, Barrio Centro, Milagro»), para rellenar la dirección
 * de entrega cuando el cliente usa su ubicación. Es solo una SUGERENCIA: el cliente la revisa y agrega una referencia.
 *
 * Proveedores (se elige por variables de entorno):
 *  - Google Geocoding API, si hay GOOGLE_GEOCODING_API_KEY (más preciso; se paga por consulta).
 *  - OpenStreetMap Nominatim, por defecto (gratis; su política pide poco volumen, 1 consulta por segundo,
 *    identificarse con un contacto y guardar los resultados: aquí hay caché y límite).
 *  - REVERSE_GEOCODING_ENABLED=false lo apaga: el cliente simplemente escribe su dirección.
 * Cualquier fallo devuelve null y nunca impide hacer un pedido.
 */

export type GeocodeProvider = "google" | "nominatim";

export function geocodingProvider(): GeocodeProvider | null {
  if (process.env.REVERSE_GEOCODING_ENABLED?.trim().toLowerCase() === "false") return null;
  return process.env.GOOGLE_GEOCODING_API_KEY?.trim() ? "google" : "nominatim";
}

const clean = (text: string) => text.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim().slice(0, 200);

/** Calle + número, barrio y ciudad a partir de la respuesta de Nominatim. Sin calle ni barrio no sirve (null). */
export function formatNominatimAddress(data: { address?: Record<string, string | undefined> } | null | undefined): string | null {
  const a = data?.address;
  if (!a) return null;
  const street = a.road ?? a.pedestrian ?? a.residential ?? a.footway ?? a.path;
  const line = street ? (a.house_number ? `${street} ${a.house_number}` : street) : null;
  const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district;
  const city = a.city ?? a.town ?? a.village ?? a.municipality;
  if (!line && !area) return null;
  const parts: string[] = [];
  for (const part of [line, area, city]) {
    if (part && !parts.some((p) => p.toLowerCase() === part.toLowerCase())) parts.push(part);
  }
  return clean(parts.join(", "));
}

const PLUS_CODE = /^[0-9A-Z]{4,8}\+[0-9A-Z]{2,}/;

/** Primera dirección legible de la respuesta de Google (se descartan los «plus codes» y se quita el país). */
export function formatGoogleAddress(data: { status?: string; results?: Array<{ formatted_address?: string }> } | null | undefined): string | null {
  if (!data || data.status !== "OK") return null;
  for (const r of data.results ?? []) {
    const text = r.formatted_address?.trim();
    if (!text || PLUS_CODE.test(text)) continue;
    const withoutCountry = text.replace(/,\s*Ecuador\s*$/i, "");
    if (withoutCountry) return clean(withoutCountry);
  }
  return null;
}

// ---------------------------------------------------------------------------- caché y ritmo
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 1000;
const cache = new Map<string, { value: string | null; expiresAt: number }>();
export function clearGeocodeCache() { cache.clear(); nextNominatimSlot = 0; }

let nextNominatimSlot = 0;
/** Nominatim permite como máximo 1 consulta por segundo. Si la cola ya es larga, se omite en vez de hacer esperar. */
async function waitForNominatimSlot(now: number): Promise<boolean> {
  const start = Math.max(now, nextNominatimSlot);
  if (start - now > 3000) return false;
  nextNominatimSlot = start + 1100;
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
  return true;
}

export async function reverseGeocode(lat: number, lng: number, now = Date.now()): Promise<{ address: string } | null> {
  const provider = geocodingProvider();
  // Solo dentro de la zona de servicio: así no sirve de geocodificador gratuito para cualquier punto del mundo.
  if (!provider || !isInServiceArea(lat, lng)) return null;

  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value ? { address: hit.value } : null;

  let value: string | null = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    if (provider === "google") {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.search = new URLSearchParams({ latlng: `${lat},${lng}`, language: "es", result_type: "street_address|route|premise", key: process.env.GOOGLE_GEOCODING_API_KEY!.trim() }).toString();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      value = formatGoogleAddress(await response.json() as any);
    } else {
      if (!(await waitForNominatimSlot(now))) return null;
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.search = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lng), zoom: "18", addressdetails: "1", "accept-language": "es" }).toString();
      const contact = process.env.NOMINATIM_CONTACT?.trim();
      const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": contact ? `AlRescate/1.0 (${contact})` : "AlRescate/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      value = formatNominatimAddress(await response.json() as any);
    }
  } catch (error) {
    console.error("No se pudo obtener la dirección de la ubicación:", error instanceof Error ? error.message : error);
    return null; // un fallo no se guarda en caché: se puede reintentar de inmediato
  } finally {
    clearTimeout(timeout);
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { value, expiresAt: now + (value ? HIT_TTL_MS : MISS_TTL_MS) });
  return value ? { address: value } : null;
}
