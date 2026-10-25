import type { Business } from "../db/schema";

export type * from "../db/schema";
export * from "./errors";

/**
 * Comercio tal como lo ven clientes y repartidores: sin el dueño, la nota interna de moderación
 * ni los cambios de nombre/dirección pendientes de revisión.
 * Debe coincidir con HIDDEN_BUSINESS_FIELDS en server/lib/public-business.ts.
 */
export type PublicBusinessView = Omit<Business, "ownerId" | "approvalNote" | "pendingName" | "pendingAddress">;
