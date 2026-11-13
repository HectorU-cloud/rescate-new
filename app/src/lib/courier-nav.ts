/**
 * Qué botón de navegación le toca al repartidor según el estado de su pedido:
 *  - Pedido reservado, todavía en el local ("por recoger"): solo «Ir al local».
 *  - Pedido ya recogido ("en camino"): solo «Ir con el cliente».
 * Así nunca tiene delante la opción equivocada (ir al local con el pedido ya en la mano, o ir con el cliente antes de recogerlo).
 */
export type NavTarget = { kind: "business" | "customer"; label: string; href: string };

const isCoord = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** Enlace de Google Maps con la ruta por calles desde donde esté la persona hasta el destino. */
export const mapsDirectionsUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

export function courierNavTarget(
  order: { status: string; deliveryLat?: number | null; deliveryLng?: number | null },
  business: { lat?: number | null; lng?: number | null } | null | undefined,
): NavTarget | null {
  if (order.status === "picked_up") {
    if (!isCoord(order.deliveryLat) || !isCoord(order.deliveryLng)) return null;
    return { kind: "customer", label: "🧭 Ir con el cliente", href: mapsDirectionsUrl(order.deliveryLat, order.deliveryLng) };
  }
  if (order.status === "ready") {
    if (!isCoord(business?.lat) || !isCoord(business?.lng)) return null;
    return { kind: "business", label: "🧭 Ir al local", href: mapsDirectionsUrl(business!.lat as number, business!.lng as number) };
  }
  return null; // entregado, cancelado, etc.: no hay a dónde ir
}
