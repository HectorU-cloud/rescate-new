import { cityById, cityIdForPoint } from "@contracts/cities";

/**
 * Reglas de "el repartidor solo trabaja en su ciudad". La ciudad de un pedido es la de su LOCAL (donde se recoge),
 * calculada desde el pin del local, igual que en el catálogo.
 */

export type CourierCityCheck =
  | { ok: true }
  | { ok: false; reason: "no-city" | "other-city"; message: string };

/** ¿Puede este repartidor ver / tomar un pedido que se recoge en `pickup`? */
export function courierCityCheck(courierCityId: string | null | undefined, pickup: { lat: number; lng: number }): CourierCityCheck {
  const mine = cityById(courierCityId);
  if (!mine) return { ok: false, reason: "no-city", message: "Elige tu ciudad de trabajo para ver y tomar pedidos." };
  const orderCity = cityById(cityIdForPoint(pickup.lat, pickup.lng));
  if (orderCity?.id !== mine.id) {
    return { ok: false, reason: "other-city", message: `Este pedido es de ${orderCity?.name ?? "otra ciudad"}. Cambia tu ciudad de trabajo para tomarlo.` };
  }
  return { ok: true };
}

export const canCourierSeeOrder = (courierCityId: string | null | undefined, pickup: { lat: number; lng: number }) =>
  courierCityCheck(courierCityId, pickup).ok;
