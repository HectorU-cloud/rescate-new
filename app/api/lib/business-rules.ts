import { BUSINESS_RULES } from "@contracts/constants";

export function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Distancia en línea recta (km) entre dos coordenadas. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

type DeliveryBusiness = {
  lat: number;
  lng: number;
  deliveryFee: number;
  feePerKm: number;
  deliveryRadiusKm: number;
  minOrder: number;
};

export type DeliveryQuote = {
  distanceKm: number;
  fee: number;
  withinRadius: boolean;
  radiusKm: number;
  minOrder: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Distancia estimada por calles y tarifa = base + costo por km. */
export function quoteDelivery(business: DeliveryBusiness, destLat: number, destLng: number): DeliveryQuote {
  const straight = haversineKm(business.lat, business.lng, destLat, destLng);
  const distanceKm = Math.round(straight * BUSINESS_RULES.routeFactor * 10) / 10;
  const fee = round2(business.deliveryFee + business.feePerKm * distanceKm);
  return {
    distanceKm,
    fee,
    withinRadius: distanceKm <= business.deliveryRadiusKm,
    radiusKm: business.deliveryRadiusKm,
    minOrder: business.minOrder,
  };
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minutos desde medianoche en hora de Ecuador. */
export function ecuadorMinutesNow(now = new Date()) {
  const shifted = new Date(now.getTime() + BUSINESS_RULES.timezoneOffsetHours * 3600_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** ¿El comercio está dentro de su horario? Soporta horarios que cruzan la medianoche. */
export function isWithinHours(opensAt: string, closesAt: string, now = new Date()) {
  const open = toMinutes(opensAt);
  const close = toMinutes(closesAt);
  const cur = ecuadorMinutesNow(now);
  if (open === close) return true; // 24 horas
  return open < close ? cur >= open && cur < close : cur >= open || cur < close;
}

/** Abierto = el comercio lo tiene activado manualmente Y está dentro de su horario. */
export function isBusinessOpenNow(b: { isOpen: boolean; opensAt: string; closesAt: string }, now = new Date()) {
  return b.isOpen && isWithinHours(b.opensAt, b.closesAt, now);
}
