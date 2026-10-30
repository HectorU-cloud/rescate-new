/**
 * Pedidos que el repartidor ocultó de su tablero ("No me interesa"). Es solo una preferencia de este dispositivo:
 * el pedido sigue disponible para los demás repartidores y no cambia nada en el servidor.
 */
const MAX_REMEMBERED = 200;

export const dismissedKey = (userId: number) => `rescate-dismissed-orders:${userId}`;

export function parseDismissed(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/** Agrega un id sin duplicarlo y conserva solo los más recientes. */
export function addDismissed(current: number[], id: number): number[] {
  return [...current.filter((x) => x !== id), id].slice(-MAX_REMEMBERED);
}

/** Olvida los pedidos que ya no están en el tablero (se tomaron o se cancelaron), para no crecer sin fin. */
export function pruneDismissed(current: number[], availableIds: number[]): number[] {
  const live = new Set(availableIds);
  return current.filter((id) => live.has(id));
}
