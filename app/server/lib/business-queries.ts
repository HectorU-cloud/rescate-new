import { inArray } from "drizzle-orm";
import { businesses } from "@db/schema";
import { getDb } from "../queries/connection";
import { toPublicBusiness, type PublicBusiness } from "./public-business";

/**
 * Comercios (en versión pública) de una lista de ids. Reemplaza a "cargar toda la tabla y buscar en memoria":
 * el costo ya no crece con la cantidad de comercios de la plataforma.
 */
export async function loadBusinessesByIds(ids: number[]): Promise<Map<number, PublicBusiness>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await getDb().select().from(businesses).where(inArray(businesses.id, unique));
  return new Map(rows.map((b) => [b.id, toPublicBusiness(b)]));
}
