export const Session = {
  cookieName: "alrescate_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  googleLogin: "/api/oauth/google/login",
  googleCallback: "/api/oauth/google/callback",
} as const;

// ---------------------------------------------------------------------------
// Al Rescate — constantes compartidas (frontend ↔ backend)
// ---------------------------------------------------------------------------

export const MILAGRO = {
  name: "Milagro, Ecuador",
  lat: -2.134,
  lng: -79.594,
} as const;

export const BUSINESS_CATEGORIES = [
  { id: "comida-rapida", label: "Comida rápida", emoji: "🍔" },
  { id: "mariscos", label: "Mariscos", emoji: "🦐" },
  { id: "panaderia", label: "Panadería", emoji: "🥖" },
  { id: "cafeteria", label: "Cafetería", emoji: "☕" },
  { id: "supermercado", label: "Supermercado", emoji: "🛒" },
  { id: "bebidas", label: "Bebidas y jugos", emoji: "🥤" },
] as const;

export type OrderStatusKey =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "picked_up"
  | "delivered"
  | "cancelled";

export const ORDER_STATUS_LABELS: Record<
  OrderStatusKey,
  { label: string; delivery: string; rescue: string }
> = {
  pending: {
    label: "Pendiente",
    delivery: "Esperando que el local acepte tu pedido",
    rescue: "Esperando que el local confirme tu rescate",
  },
  accepted: {
    label: "Aceptado",
    delivery: "El local aceptó tu pedido",
    rescue: "Tu pack está apartado",
  },
  preparing: {
    label: "Preparando",
    delivery: "Tu pedido está en la cocina",
    rescue: "El local está armando tu pack",
  },
  ready: {
    label: "Listo",
    delivery: "Listo, esperando repartidor",
    rescue: "Listo, pásalo a retirar",
  },
  picked_up: {
    label: "En camino",
    delivery: "El repartidor va en camino",
    rescue: "En camino",
  },
  delivered: {
    label: "Entregado",
    delivery: "¡Pedido entregado! Buen provecho",
    rescue: "¡Rescate completado! Menos desperdicio",
  },
  cancelled: { label: "Cancelado", delivery: "Pedido cancelado", rescue: "Rescate cancelado" },
};

// Flujo de estados visibles en la línea de tiempo (sin cancelled)
export const DELIVERY_FLOW: OrderStatusKey[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "delivered",
];

export const RESCUE_FLOW: OrderStatusKey[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "delivered",
];

export const APP_ROLES = [
  { id: "customer", label: "Quiero pedir", emoji: "🛵", desc: "Pide comida a domicilio o rescata packs con descuento" },
  { id: "business", label: "Tengo un negocio", emoji: "🏪", desc: "Vende tu catálogo y publica packs de rescate" },
  { id: "courier", label: "Soy repartidor", emoji: "🏍️", desc: "Toma entregas cercanas y gana por cada pedido" },
] as const;

export type AppRole = (typeof APP_ROLES)[number]["id"];

// ---------------------------------------------------------------------------
// Reglas de negocio del delivery (únicas, compartidas frontend ↔ backend)
// ---------------------------------------------------------------------------
export const BUSINESS_RULES = {
  // Zona horaria de Ecuador continental (UTC-5, sin horario de verano)
  timezoneOffsetHours: -5,
  // Factor para convertir distancia en línea recta a distancia estimada por calles
  routeFactor: 1.3,
  maxDeliveryRadiusKm: 15,
  // Minutos máximos que un pedido "listo" espera repartidor antes de cancelarse solo
  courierAssignTimeoutMin: 20,
  // A los X minutos sin repartidor se vuelve a avisar a los repartidores
  courierReminderAfterMin: 8,
  // Minutos máximos que un pedido "pendiente" espera que el comercio lo acepte
  businessAcceptTimeoutMin: 15,
  // El repartidor solo puede soltar un pedido en estos minutos tras tomarlo
  courierReleaseWindowMin: 5,
  // Estados en los que el cliente todavía puede cancelar
  customerCancelableStatuses: ["pending", "accepted"],
  // Delivery aceptado o en cocina que el comercio no hace avanzar:
  // a los 25 min se le recuerda por push y a los 60 min se cancela solo.
  businessProgressReminderMin: 25,
  businessProgressTimeoutMin: 60,
} as const;
