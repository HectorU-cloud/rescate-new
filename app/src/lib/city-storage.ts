import { cityById } from "@contracts/cities";

/** Clave donde se recuerda, en este dispositivo, la ciudad elegida. */
export const CITY_STORAGE_KEY = "rescate-city";

/** Cómo se eligió: con el GPS, a mano, o saltando la pregunta (equivale a "todas las ciudades"). */
export type CitySource = "gps" | "manual" | "skipped";

/** `cityId: null` significa "todas las ciudades" (sin filtro). */
export type CityChoice = { cityId: string | null; source: CitySource };

/**
 * Lee lo guardado con tolerancia total: cualquier cosa rara (texto corrupto, una ciudad que ya no existe,
 * una combinación imposible) devuelve null y la app simplemente vuelve a preguntar.
 */
export function parseCityChoice(raw: string | null): CityChoice | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { cityId, source } = value as { cityId?: unknown; source?: unknown };
  if (source !== "gps" && source !== "manual" && source !== "skipped") return null;
  if (cityId === null) return source === "gps" ? null : { cityId: null, source }; // el GPS siempre da una ciudad concreta
  if (typeof cityId !== "string" || !cityById(cityId)) return null;
  if (source === "skipped") return null; // "saltar" nunca elige una ciudad concreta
  return { cityId, source };
}

export const serializeCityChoice = (choice: CityChoice) => JSON.stringify({ cityId: choice.cityId, source: choice.source, at: Date.now() });
