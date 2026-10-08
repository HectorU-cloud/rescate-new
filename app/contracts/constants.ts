export const Session = {
  cookieName: "kimi_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  oauthCallback: "/api/oauth/callback",
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
