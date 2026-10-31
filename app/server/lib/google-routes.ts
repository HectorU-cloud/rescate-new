import { deliveryRates, quoteDelivery, type DeliveryPricing } from "./business-rules";
import { priceDelivery } from "@contracts/pricing";

type RouteBusiness = { lat: number; lng: number; deliveryFee: number; feePerKm: number; deliveryRadiusKm: number; minOrder: number };
type GoogleRoutesResponse = { routes?: Array<{ distanceMeters?: number; duration?: string; staticDuration?: string }> };
const envTrue = (value: string | undefined) => value?.trim().toLowerCase() === "true";

/** Usa Google Routes cuando está habilitado; ante cualquier fallo conserva el cálculo aproximado. */
export async function quoteDeliveryWithGoogleRoutes(business: RouteBusiness, destLat: number, destLng: number, pricing?: DeliveryPricing) {
  const fallback = () => ({ ...quoteDelivery(business, destLat, destLng, pricing), routeProvider: "fallback" as const, staticMinutes: undefined as number | undefined });
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY?.trim();
  if (!envTrue(process.env.GOOGLE_ROUTES_ENABLED) || !apiKey) return fallback();
  const configuredTimeout = Number(process.env.GOOGLE_ROUTES_TIMEOUT_MS ?? 4500);
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.min(10000, Math.max(1000, configuredTimeout)) : 4500;
  const trafficAware = process.env.GOOGLE_ROUTES_TRAFFIC_AWARE === undefined || envTrue(process.env.GOOGLE_ROUTES_TRAFFIC_AWARE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.staticDuration" },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: business.lat, longitude: business.lng } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode: "DRIVE", ...(trafficAware ? { routingPreference: "TRAFFIC_AWARE" } : {}), languageCode: "es", units: "METRIC",
      }),
      signal: controller.signal,
    });
    if (!response.ok) return fallback();
    const data = (await response.json()) as GoogleRoutesResponse;
    const route = data.routes?.[0];
    const meters = Number(route?.distanceMeters);
    const seconds = Number.parseFloat(String(route?.duration ?? "").replace(/s$/, ""));
    if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(seconds) || seconds <= 0) return fallback();
    const distanceKm = Math.round((meters / 1000) * 10) / 10;
    const estimatedMinutes = Math.max(1, Math.ceil(seconds / 60));
    // Minutos sin tráfico (solo para medir cuánto lo alarga); si Google no lo manda, simplemente no hay medición.
    const staticSeconds = Number.parseFloat(String(route?.staticDuration ?? "").replace(/s$/, ""));
    const staticMinutes = Number.isFinite(staticSeconds) && staticSeconds > 0 ? Math.max(1, Math.ceil(staticSeconds / 60)) : undefined;
    const rates = deliveryRates(business, pricing);
    const priced = priceDelivery({ ...rates, distanceKm, minutes: estimatedMinutes });
    return { distanceKm, estimatedMinutes, ...rates, ...priced, withinRadius: distanceKm <= business.deliveryRadiusKm, radiusKm: business.deliveryRadiusKm, minOrder: business.minOrder, routeProvider: "google" as const, staticMinutes };
  } catch { return fallback(); }
  finally { clearTimeout(timeout); }
}
