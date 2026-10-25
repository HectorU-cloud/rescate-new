import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BUSINESS_RULES, MILAGRO } from "@contracts/constants";
import { isInServiceArea } from "@contracts/geo";
import { addBaseLayer } from "@/lib/map-tiles";

export type Point = { lat: number; lng: number };

type Props = {
  value: Point | null;
  onChange: (point: Point) => void;
  className?: string;
};

// Pin con emoji fijo (nunca texto de usuarios: evita inyección de HTML)
const pin = L.divIcon({
  className: "",
  iconSize: [40, 40],
  iconAnchor: [20, 36],
  html: `<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:24px;background:#fff;border:2px solid #fff;border-radius:9999px;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:grab">🏪</div>`,
});

/**
 * Mapa para marcar el punto exacto de un local: toca el mapa, arrastra el pin o usa el GPS.
 */
export function LocationPicker({ value, onChange, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const initialRef = useRef(value);
  const [hint, setHint] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Crea (o mueve) el pin
  const placeMarker = (point: Point, zoomIn = false) => {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([point.lat, point.lng]);
    } else {
      const marker = L.marker([point.lat, point.lng], { icon: pin, draggable: true, title: "Tu local", keyboard: false }).addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLatLng();
        onChangeRef.current({ lat, lng });
      });
      markerRef.current = marker;
    }
    if (zoomIn) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 17));
  };

  // Crear el mapa una sola vez
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const start = initialRef.current;
    const map = L.map(el).setView(start ? [start.lat, start.lng] : [MILAGRO.lat, MILAGRO.lng], start ? 17 : 14);
    addBaseLayer(map);
    mapRef.current = map;
    if (start) placeMarker(start);
    map.on("click", (e: L.LeafletMouseEvent) => {
      const point = { lat: e.latlng.lat, lng: e.latlng.lng };
      placeMarker(point);
      onChangeRef.current(point);
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
  }, []);

  // Si el valor cambia desde fuera, mueve el pin
  useEffect(() => {
    if (!value) return;
    const current = markerRef.current?.getLatLng();
    if (!current || Math.abs(current.lat - value.lat) > 1e-7 || Math.abs(current.lng - value.lng) > 1e-7) placeMarker(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  const useGps = () => {
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      setHint("El GPS solo funciona con HTTPS. Toca el mapa para marcar tu local.");
      return;
    }
    setLocating(true);
    setHint(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        placeMarker(point, true);
        onChangeRef.current(point);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setHint("No pudimos obtener tu ubicación. Revisa el permiso del navegador o toca el mapa.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
  };

  const outside = !!value && !isInServiceArea(value.lat, value.lng);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className={`relative isolate z-0 overflow-hidden rounded-2xl ring-1 ring-border ${className ?? "h-64 w-full"}`} />
      <button
        type="button"
        onClick={useGps}
        disabled={locating}
        className="w-full rounded-xl bg-secondary px-4 py-2.5 text-xs font-extrabold disabled:opacity-50"
      >
        {locating ? "Buscando tu ubicación…" : "📍 Usar mi ubicación actual (si estás en el local)"}
      </button>
      {hint && <p className="text-xs font-bold text-destructive">{hint}</p>}
      {value ? (
        <p className={`text-xs font-bold ${outside ? "text-destructive" : "text-brand-dark"}`}>
          {outside
            ? `⚠️ Ese punto está fuera de la zona de servicio (${BUSINESS_RULES.serviceAreaRadiusKm} km alrededor de Milagro).`
            : `✅ Ubicación marcada (${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}). Arrastra el pin si hay que afinarla.`}
        </p>
      ) : (
        <p className="text-xs font-semibold text-muted-foreground">Toca el mapa en la puerta de tu local (puedes acercar con + / −).</p>
      )}
    </div>
  );
}
