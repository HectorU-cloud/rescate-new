import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addBaseLayer } from "@/lib/map-tiles";

type Props = {
  lat: number;
  lng: number;
  emoji: string;
  label: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
  className?: string;
};

/**
 * Mapa de seguimiento de solo lectura.
 * La línea entre la posición actual y el destino es orientativa (no es navegación por calles).
 * Se reemplazará por geometría de Google Routes cuando se active esa integración.
 */
export function StaticMap({
  lat,
  lng,
  emoji,
  label,
  destinationLat,
  destinationLng,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const destinationMarkerRef = useRef<L.Marker | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 14);
    addBaseLayer(map);

    const currentIcon = L.divIcon({
      className: "",
      iconSize: [38, 38],
      iconAnchor: [19, 34],
      html: `<div style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:21px;background:#fff;border:2px solid #0f766e;border-radius:9999px;box-shadow:0 2px 8px rgba(0,0,0,.25)">${emoji}</div>`,
    });
    const destinationIcon = L.divIcon({
      className: "",
      iconSize: [36, 36],
      iconAnchor: [18, 32],
      html: '<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:21px;background:#fff;border:2px solid #ea580c;border-radius:9999px;box-shadow:0 2px 8px rgba(0,0,0,.25)">📍</div>',
    });

    markerRef.current = L.marker([lat, lng], {
      icon: currentIcon,
      keyboard: false,
      interactive: false,
    }).addTo(map);

    if (
      destinationLat != null &&
      destinationLng != null &&
      Number.isFinite(destinationLat) &&
      Number.isFinite(destinationLng)
    ) {
      destinationMarkerRef.current = L.marker([destinationLat, destinationLng], {
        icon: destinationIcon,
        keyboard: false,
        interactive: false,
      }).addTo(map);
      routeRef.current = L.polyline(
        [[lat, lng], [destinationLat, destinationLng]],
        { color: "#0f766e", weight: 4, opacity: 0.8, dashArray: "8 8" },
      ).addTo(map);
      map.fitBounds(
        L.latLngBounds([[lat, lng], [destinationLat, destinationLng]]),
        { padding: [32, 32], maxZoom: 15 },
      );
    }

    mapRef.current = map;
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => map.invalidateSize())
      : null;
    observer?.observe(el);

    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      destinationMarkerRef.current = null;
      routeRef.current = null;
    };
  // Map is initialized once; coordinate updates are handled in the effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    markerRef.current?.setLatLng([lat, lng]);
    routeRef.current?.setLatLngs(
      destinationLat != null && destinationLng != null
        ? [[lat, lng], [destinationLat, destinationLng]]
        : [],
    );
    if (destinationLat != null && destinationLng != null) {
      destinationMarkerRef.current?.setLatLng([destinationLat, destinationLng]);
      const bounds = L.latLngBounds([[lat, lng], [destinationLat, destinationLng]]);
      mapRef.current?.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
    } else {
      mapRef.current?.panTo([lat, lng]);
    }
  }, [lat, lng, destinationLat, destinationLng]);

  return <div ref={containerRef} role="img" aria-label={label} className={className} />;
}
