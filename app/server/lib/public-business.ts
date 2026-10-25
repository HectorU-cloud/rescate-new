import type { businesses } from "@db/schema";

type Business = typeof businesses.$inferSelect;

/**
 * Campos del comercio que NO deben salir por las consultas públicas ni por las de clientes y repartidores:
 * el dueño, la nota interna de moderación y los cambios de nombre/dirección que aún espera revisar el admin.
 * (El panel del propio comercio y el del admin usan sus consultas propias, con el registro completo.)
 */
export const HIDDEN_BUSINESS_FIELDS = ["ownerId", "approvalNote", "pendingName", "pendingAddress"] as const;
export type PublicBusiness<T extends Business = Business> = Omit<T, (typeof HIDDEN_BUSINESS_FIELDS)[number]>;

export function toPublicBusiness<T extends Business>(business: T): PublicBusiness<T> {
  const out: Record<string, unknown> = { ...business };
  for (const key of HIDDEN_BUSINESS_FIELDS) delete out[key];
  return out as PublicBusiness<T>;
}
