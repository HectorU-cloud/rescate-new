import L from "leaflet";

/**
 * Capa base de todos los mapas de la app.
 *
 * Los servidores de tile.openstreetmap.org son de la comunidad y su política de uso prohíbe el uso intensivo
 * o comercial. Antes de lanzar configura un proveedor de teselas (MapTiler, Stadia Maps, Thunderforest,
 * Mapbox, o tu propio servidor) con estas variables de Vercel (se leen al compilar):
 *
 *   VITE_MAP_TILE_URL=https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=TU_CLAVE
 *   VITE_MAP_ATTRIBUTION=&copy; MapTiler &copy; OpenStreetMap contributors
 *   VITE_MAP_MAX_ZOOM=19            (opcional)
 *
 * Las claves de teselas son públicas por naturaleza: restríngelas por dominio en el panel del proveedor.
 * Sin variables se usa OpenStreetMap, aceptable solo para desarrollo y pruebas con poca gente.
 */
const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function addBaseLayer(map: L.Map) {
  const url = (import.meta.env.VITE_MAP_TILE_URL as string | undefined)?.trim() || OSM_URL;
  const attribution = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined)?.trim() || "&copy; OpenStreetMap contributors";
  const maxZoom = Number(import.meta.env.VITE_MAP_MAX_ZOOM) || 19;
  if (import.meta.env.PROD && url === OSM_URL) {
    console.warn("[mapa] Usando los servidores públicos de OpenStreetMap. Configura VITE_MAP_TILE_URL con un proveedor de teselas antes de lanzar.");
  }
  return L.tileLayer(url, { maxZoom, attribution }).addTo(map);
}
