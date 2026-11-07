// Ciudades donde opera la plataforma. Compartido entre el servidor (filtra el catálogo) y la app (detecta la ciudad).
//
// Para AGREGAR una ciudad basta con añadir una línea a CITIES: no hay nada más que tocar (ni base de datos).
// Las coordenadas son el centro aproximado de la ciudad (compruébalas en Google Maps antes de abrir una ciudad nueva).
import { distanceMeters } from "./geo";

export type City = {
  /** Identificador estable (minúsculas, sin espacios). Es lo que se guarda en el dispositivo y viaja en las consultas. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Hasta dónde llega la ciudad al DETECTAR dónde está una persona. Fuera de este radio no se la considera de allí. */
  radiusKm: number;
};

export const CITIES: readonly City[] = [
  { id: "milagro", name: "Milagro", lat: -2.134, lng: -79.594, radiusKm: 12 },
  { id: "yaguachi", name: "Yaguachi", lat: -2.1167, lng: -79.6833, radiusKm: 8 },
  { id: "naranjito", name: "Naranjito", lat: -2.175, lng: -79.4667, radiusKm: 7 },
  { id: "duran", name: "Durán", lat: -2.1733, lng: -79.8353, radiusKm: 8 },
  { id: "guayaquil", name: "Guayaquil", lat: -2.1894, lng: -79.8891, radiusKm: 14 },
];

export const cityById = (id: string | null | undefined): City | null => (id ? CITIES.find((c) => c.id === id) ?? null : null);

export const cityLabel = (city: City | null) => (city ? `${city.name}, Ecuador` : "Todas las ciudades");

const kmBetween = (lat: number, lng: number, city: City) => distanceMeters(lat, lng, city.lat, city.lng) / 1000;

/** La ciudad cuyo centro queda más cerca del punto, y a cuántos km. */
export function nearestCity(lat: number, lng: number): { city: City; distanceKm: number } {
  let best = { city: CITIES[0], distanceKm: Number.POSITIVE_INFINITY };
  for (const city of CITIES) {
    const distanceKm = kmBetween(lat, lng, city);
    if (distanceKm < best.distanceKm) best = { city, distanceKm };
  }
  return best;
}

/**
 * A qué ciudad pertenece un LOCAL según su pin: siempre la más cercana. Así ningún local queda sin ciudad
 * (ni desaparece del catálogo) aunque su pin caiga entre dos poblaciones; y si el dueño mueve el pin, cambia solo.
 */
export const cityIdForPoint = (lat: number, lng: number): string => nearestCity(lat, lng).city.id;

export type CityDetection =
  | { city: City; distanceKm: number }
  /** La persona no está dentro de ninguna de nuestras ciudades; `nearest` es la más cercana a ella. */
  | { city: null; nearest: City; distanceKm: number };

/** En qué ciudad está una PERSONA según su GPS. Solo cuenta si está dentro del radio de la ciudad más cercana. */
export function detectCity(lat: number, lng: number): CityDetection {
  const { city, distanceKm } = nearestCity(Number.isFinite(lat) ? lat : 0, Number.isFinite(lng) ? lng : 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { city: null, nearest: city, distanceKm: Number.POSITIVE_INFINITY };
  return distanceKm <= city.radiusKm ? { city, distanceKm } : { city: null, nearest: city, distanceKm };
}
