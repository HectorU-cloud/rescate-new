/**
 * Detecta pedidos nuevos entre dos consultas consecutivas del panel del comercio.
 * `seen === null` significa "primera carga": se toma como línea base y no se avisa
 * (si no, cada vez que se abre el panel sonaría por pedidos que ya estaban).
 */
export function findNewIds(seen: Set<number> | null, current: number[]): number[] {
  if (seen === null) return [];
  return current.filter((id) => !seen.has(id));
}
