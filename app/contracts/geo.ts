// Geografía compartida entre frontend y backend.
import { BUSINESS_RULES, MILAGRO } from "./constants";

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distancia en línea recta (metros) entre dos coordenadas. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** ¿El punto está dentro de la zona donde opera la plataforma (alrededor de Milagro)? */
export function isInServiceArea(lat: number, lng: number) {
  return distanceMeters(MILAGRO.lat, MILAGRO.lng, lat, lng) <= BUSINESS_RULES.serviceAreaRadiusKm * 1000;
}
