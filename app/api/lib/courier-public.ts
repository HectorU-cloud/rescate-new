/**
 * Datos del repartidor que el cliente (y el comercio) pueden ver durante la entrega.
 * Es una lista cerrada a propósito: nunca incluye correo, teléfono ni estado de aprobación.
 */
export type PublicCourier = {
  name: string | null; // solo el primer nombre
  photoUrl: string | null;
  vehicle: string | null;
  plate: string | null;
  rating: number | null;
  ratingCount: number;
};

export function toPublicCourier(u: {
  name: string | null;
  courierPhotoUrl: string | null;
  courierVehicle: string | null;
  courierPlate: string | null;
  courierRating: number | null;
  courierRatingCount: number;
}): PublicCourier {
  return {
    name: u.name?.trim().split(/\s+/)[0] || null,
    photoUrl: u.courierPhotoUrl || null,
    vehicle: u.courierVehicle?.trim() || null,
    plate: u.courierPlate?.trim().toUpperCase() || null,
    rating: u.courierRating ?? null,
    ratingCount: u.courierRatingCount,
  };
}

/** Se muestra al repartidor solo cuando lleva el pedido o ya lo entregó (no si se canceló o aún no hay repartidor). */
export function shouldShowCourier(order: { type: string; status: string; courierId: number | null }) {
  return order.type === "delivery" && order.courierId != null && (order.status === "picked_up" || order.status === "delivered");
}
