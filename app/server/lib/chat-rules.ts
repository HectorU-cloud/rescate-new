/**
 * Reglas del chat cliente ↔ repartidor. Son funciones puras (sin base de datos)
 * para poder probarlas con tests unitarios.
 */

export const CHAT_RULES = {
  maxLength: 500,
  /** Mensajes máximos por persona y pedido en un minuto (freno al spam). */
  maxPerMinute: 10,
  /** Largo del texto que se muestra en la notificación push. */
  previewLength: 90,
} as const;

export type ChatRole = "customer" | "courier";

/** El chat solo está abierto mientras un repartidor lleva el pedido (estado "en camino"). */
export function canChatNow(order: { type: string; status: string; courierId: number | null }) {
  return order.type === "delivery" && order.status === "picked_up" && order.courierId != null;
}

/** Rol de la persona en el chat del pedido, o null si no participa (comercio, terceros, repartidor anterior). */
export function chatRoleFor(order: { customerId: number; courierId: number | null }, userId: number): ChatRole | null {
  if (order.customerId === userId) return "customer";
  if (order.courierId != null && order.courierId === userId) return "courier";
  return null;
}

/**
 * ¿El mensaje contiene el código de confirmación de entrega? Compara solo dígitos, así que
 * "482 913" o "4-8-2-9-1-3" también se detectan. Ese código solo debe decirse en persona.
 */
export function containsConfirmationCode(body: string, code: string | null | undefined) {
  if (!code) return false;
  return body.replace(/\D/g, "").includes(code);
}

/** Recorta y limpia el texto que se muestra en la notificación. */
export function chatPreview(body: string, max: number = CHAT_RULES.previewLength) {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
