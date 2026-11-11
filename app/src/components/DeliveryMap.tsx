import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MILAGRO } from "@contracts/constants";
import { isInServiceArea } from "@contracts/geo";
import { addBaseLayer } from "@/lib/map-tiles";
import { useCity } from "@/hooks/useCity";
import type { Point } from "@/components/LocationPicker";

type Props = {
  /** Punto de entrega actual (null = todavía sin marcar). */
  value: Point | null;
  /** El cliente tocó el mapa o soltó el pin: es una elección suya, no una búsqueda. */
  onPick: (point: Point) => void;
  className?: string;
};

// Pin con emoji fijo (nunca texto de usuarios: evita inyección de HTML)
const pin = L.divIcon({
  className: "",
  iconSize: [40, 40],
  iconAnchor: [20, 36],
  html: `<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:24px;background:#fff;border:2px solid #fff;border-radius:9999px;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:grab">🏠</div>`,
});

/**
 * Mapa para marcar dónde se entrega: toca el mapa o arrastra el pin. Si `value` cambia desde fuera (p. ej. la
 * búsqueda de una dirección escrita), el pin se mueve y el mapa se centra ahí.
 */
export function DeliveryMap({ value, onPick, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const initialRef = useRef(value);
  const { city } = useCity();
  const defaultCenterRef = useRef<Point>(city ?? MILAGRO);

  useEffect(() => {
    onPickRef.current = onPick;
  });

  const placeMarker = (point: Point, center: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([point.lat, point.lng]);
    } else {
      const marker = L.marker([point.lat, point.lng], { icon: pin, draggable: true, title: "Dónde se entrega", keyboard: false }).addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLatLng();
        onPickRef.current({ lat, lng });
      });
      markerRef.current = marker;
    }
    if (center) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 16));
  };

  // Crear el mapa una sola vez
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const start = initialRef.current;
    const fallback = defaultCenterRef.current;
    const map = L.map(el).setView(start ? [start.lat, start.lng] : [fallback.lat, fallback.lng], start ? 17 : 14);
    addBaseLayer(map);
    mapRef.current = map;
    if (start) placeMarker(start, false);
    map.on("click", (e: L.LeafletMouseEvent) => {
      const point = { lat: e.latlng.lat, lng: e.latlng.lng };
      placeMarker(point, false);
      onPickRef.current(point);
    });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // El mapa se crea una vez; el pin se sincroniza en el efecto siguiente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si el valor cambia desde fuera, mueve el pin y centra el mapa; si se vació, quita el pin.
  useEffect(() => {
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const current = markerRef.current?.getLatLng();
    if (!current || Math.abs(current.lat - value.lat) > 1e-7 || Math.abs(current.lng - value.lng) > 1e-7) placeMarker(value, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  const outside = !!value && !isInServiceArea(value.lat, value.lng);

  return (
    <div className="space-y-1">
      <div ref={containerRef} className={`relative isolate z-0 overflow-hidden rounded-2xl ring-1 ring-border ${className ?? "h-64 w-full"}`} />
      {outside && <p className="text-xs font-bold text-destructive">⚠️ Ese punto está fuera de la zona de servicio (las ciudades donde operamos).</p>}
    </div>
  );
}
