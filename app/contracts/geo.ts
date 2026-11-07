// Geografía compartida entre frontend y backend.
import { BUSINESS_RULES, MILAGRO } from "./constants";
import { CITIES } from "./cities";
import { distanceMeters } from "./distance";

export { distanceMeters };

/**
 * ¿El punto está dentro de la zona donde opera la plataforma?
 * Es la zona original (radio alrededor de Milagro) MÁS el área de cada ciudad de la lista: así una ciudad que queda
 * en el borde del radio —como Babahoyo— se puede usar completa, y agregar una ciudad nueva basta para que sus
 * locales puedan registrarse.
 */
export function isInServiceArea(lat: number, lng: number) {
  if (distanceMeters(MILAGRO.lat, MILAGRO.lng, lat, lng) <= BUSINESS_RULES.serviceAreaRadiusKm * 1000) return true;
  return CITIES.some((c) => distanceMeters(c.lat, c.lng, lat, lng) <= c.radiusKm * 1000);
}
