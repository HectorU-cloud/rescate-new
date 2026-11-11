import { isInServiceArea } from "@contracts/geo";
import { cityById, cityViewbox, mentionsKnownCity, type City } from "@contracts/cities";

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
export function clearGeocodeCache() { cache.clear(); searchCache.clear(); nextNominatimSlot = 0; }

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

// ---------------------------------------------------------------------------- dirección escrita → punto en el mapa
export type AddressMatch = { label: string; lat: number; lng: number };

/**
 * Ciudad hacia la que se inclina la búsqueda (sesgo SUAVE: no filtra ni cambia el texto). Si el cliente ya escribió
 * una de nuestras ciudades, no hay sesgo: manda lo que escribió. Nunca se le agrega una ciudad al texto.
 */
export function searchBiasCity(text: string, cityId: string | null | undefined): City | null {
  if (mentionsKnownCity(text)) return null;
  return cityById(cityId);
}

/** Quita duplicados, descarta lo que cae fuera de la zona de servicio y deja a lo sumo 5 coincidencias. */
function finishMatches(list: Array<AddressMatch | null>): AddressMatch[] {
  const seen = new Set<string>();
  const out: AddressMatch[] = [];
  for (const m of list) {
    if (!m || !Number.isFinite(m.lat) || !Number.isFinite(m.lng) || !isInServiceArea(m.lat, m.lng)) continue;
    const key = `${m.label.toLowerCase()}|${m.lat.toFixed(4)},${m.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length === 5) break;
  }
  return out;
}

type NominatimHit = { lat?: string; lon?: string; display_name?: string; address?: Record<string, string | undefined> };

/** Etiqueta corta a partir del nombre largo de Nominatim: sin país ni código postal, máximo 3 partes. */
function labelFromDisplayName(name: string | undefined): string | null {
  const parts = (name ?? "").split(",").map((p) => p.trim()).filter((p) => p && !/^ecuador$/i.test(p) && !/^\d+$/.test(p));
  return parts.length ? clean(parts.slice(0, 3).join(", ")) : null;
}

export function formatNominatimSearch(data: unknown): AddressMatch[] {
  if (!Array.isArray(data)) return [];
  return finishMatches((data as NominatimHit[]).map((hit) => {
    const label = formatNominatimAddress(hit) ?? labelFromDisplayName(hit.display_name);
    return label ? { label, lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  }));
}

type GoogleHit = { formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } };

export function formatGoogleSearch(data: { status?: string; results?: GoogleHit[] } | null | undefined): AddressMatch[] {
  if (!data || data.status !== "OK") return [];
  return finishMatches((data.results ?? []).map((r) => {
    const text = r.formatted_address?.trim();
    if (!text || PLUS_CODE.test(text)) return null;
    const label = clean(text.replace(/,\s*Ecuador\s*$/i, ""));
    const loc = r.geometry?.location;
    return label && loc ? { label, lat: Number(loc.lat), lng: Number(loc.lng) } : null;
  }));
}

const searchCache = new Map<string, { value: AddressMatch[]; expiresAt: number }>();

/**
 * Busca una dirección escrita y devuelve hasta 5 puntos dentro de la zona de servicio.
 *  - `null`: el servicio no está disponible (apagado, límite de Nominatim o falla); el cliente marca el punto a mano.
 *  - `[]`: el proveedor respondió pero no encontró nada en nuestras ciudades.
 * El texto se envía TAL CUAL lo escribió el cliente; `cityId` solo da un sesgo suave (ver `searchBiasCity`).
 */
export async function searchAddress(query: string, cityId?: string | null, now = Date.now()): Promise<AddressMatch[] | null> {
  const provider = geocodingProvider();
  if (!provider) return null;
  const text = clean(query);
  if (text.length < 4) return [];
  const bias = searchBiasCity(text, cityId);

  const key = `${text.toLowerCase()}|${bias?.id ?? ""}`;
  const hit = searchCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  let value: AddressMatch[];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const box = bias ? cityViewbox(bias) : null;
    if (provider === "google") {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      const params = new URLSearchParams({ address: text, components: "country:EC", language: "es", key: process.env.GOOGLE_GEOCODING_API_KEY!.trim() });
      if (box) params.set("bounds", `${box.south},${box.west}|${box.north},${box.east}`);
      url.search = params.toString();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      value = formatGoogleSearch(await response.json() as any);
    } else {
      if (!(await waitForNominatimSlot(now))) return null;
      const url = new URL("https://nominatim.openstreetmap.org/search");
      const params = new URLSearchParams({ format: "jsonv2", q: text, countrycodes: "ec", limit: "5", addressdetails: "1", "accept-language": "es" });
      if (box) { params.set("viewbox", `${box.west},${box.north},${box.east},${box.south}`); params.set("bounded", "0"); }
      url.search = params.toString();
      const contact = process.env.NOMINATIM_CONTACT?.trim();
      const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": contact ? `AlRescate/1.0 (${contact})` : "AlRescate/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      value = formatNominatimSearch(await response.json());
    }
  } catch (error) {
    console.error("No se pudo buscar la dirección escrita:", error instanceof Error ? error.message : error);
    return null; // un fallo no se guarda en caché
  } finally {
    clearTimeout(timeout);
  }

  if (searchCache.size >= CACHE_MAX) searchCache.delete(searchCache.keys().next().value as string);
  searchCache.set(key, { value, expiresAt: now + (value.length ? HIT_TTL_MS : MISS_TTL_MS) });
  return value;
}
