import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addBaseLayer } from "@/lib/map-tiles";

type Props = { lat: number; lng: number; emoji: string; label: string; className?: string };

/** Mapa de solo lectura con un marcador (emoji fijo, nunca texto de usuarios). Se recentra si cambian las coordenadas. */
export function StaticMap({ lat, lng, emoji, label, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const startRef = useRef({ lat, lng, emoji });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const start = startRef.current;
    const map = L.map(el, { scrollWheelZoom: false }).setView([start.lat, start.lng], 15);
    addBaseLayer(map);
    const icon = L.divIcon({
      className: "",
      iconSize: [36, 36],
      iconAnchor: [18, 32],
      html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:20px;background:#fff;border-radius:9999px;box-shadow:0 2px 8px rgba(0,0,0,.4)">${start.emoji}</div>`,
    });
    markerRef.current = L.marker([start.lat, start.lng], { icon, keyboard: false, interactive: false }).addTo(map);
    mapRef.current = map;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    markerRef.current?.setLatLng([lat, lng]);
    mapRef.current?.panTo([lat, lng]);
  }, [lat, lng]);

  return <div ref={containerRef} role="img" aria-label={label} className={className} />;
}
