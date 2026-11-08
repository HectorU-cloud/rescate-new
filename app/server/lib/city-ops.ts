import { CITIES, cityById, cityIdForPoint } from "@contracts/cities";

export type CityOpsRow = {
  cityId: string;
  name: string;
  /** Pedidos listos en locales de la ciudad que todavía ningún repartidor tomó. */
  waitingOrders: number;
  /** Repartidores aprobados, conectados y que trabajan en esa ciudad. */
  availableCouriers: number;
};

/**
 * Resumen operativo por ciudad para el admin: dónde hay pedidos esperando y cuántos repartidores los pueden tomar.
 * También cuenta a los repartidores aprobados que aún no eligieron ciudad (no ven pedidos hasta elegirla).
 */
export function buildCityOps(input: {
  /** Ubicación de los locales de los pedidos listos sin repartidor. */
  waitingPickups: { lat: number; lng: number }[];
  /** Repartidores aprobados (conectados o no). */
  couriers: { cityId: string | null; available: boolean }[];
}): { rows: CityOpsRow[]; couriersWithoutCity: number } {
  const waiting = new Map<string, number>();
  for (const p of input.waitingPickups) {
    const id = cityIdForPoint(p.lat, p.lng);
    waiting.set(id, (waiting.get(id) ?? 0) + 1);
  }
  const available = new Map<string, number>();
  let couriersWithoutCity = 0;
  for (const c of input.couriers) {
    const city = cityById(c.cityId);
    if (!city) {
      couriersWithoutCity += 1; // sin ciudad, o con una que ya no existe en la lista
      continue;
    }
    if (c.available) available.set(city.id, (available.get(city.id) ?? 0) + 1);
  }
  return {
    rows: CITIES.map((c) => ({ cityId: c.id, name: c.name, waitingOrders: waiting.get(c.id) ?? 0, availableCouriers: available.get(c.id) ?? 0 })),
    couriersWithoutCity,
  };
}
