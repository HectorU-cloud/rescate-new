import type { orders } from "@db/schema";

type Order = typeof orders.$inferSelect;

/**
 * Pedido tal como lo ve un repartidor en el tablero de "disponibles", ANTES de aceptarlo.
 * Solo lo necesario para decidir (local, distancia, ganancia y cuánto cobrar); nada que
 * identifique o ubique al cliente. Los datos completos se ven al aceptar el pedido.
 */
export function redactForCourierBoard<T extends Order>(order: T): T {
  return {
    ...order,
    customerName: "Cliente",
    customerPhone: null,
    deliveryAddress: "",
    deliveryLat: null,
    deliveryLng: null,
    notes: null,
    deliveryConfirmationCode: null,
    pickupCode: null,
  };
}
