import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteDeliveryWithGoogleRoutes } from "./google-routes";

const business = { lat: -2.134, lng: -79.594, deliveryFee: 1, feePerKm: 0.5, deliveryRadiusKm: 8, minOrder: 5 };
const original = {
  enabled: process.env.GOOGLE_ROUTES_ENABLED,
  key: process.env.GOOGLE_ROUTES_API_KEY,
  traffic: process.env.GOOGLE_ROUTES_TRAFFIC_AWARE,
  timeout: process.env.GOOGLE_ROUTES_TIMEOUT_MS,
};

afterEach(() => {
  if (original.enabled === undefined) delete process.env.GOOGLE_ROUTES_ENABLED; else process.env.GOOGLE_ROUTES_ENABLED = original.enabled;
  if (original.key === undefined) delete process.env.GOOGLE_ROUTES_API_KEY; else process.env.GOOGLE_ROUTES_API_KEY = original.key;
  if (original.traffic === undefined) delete process.env.GOOGLE_ROUTES_TRAFFIC_AWARE; else process.env.GOOGLE_ROUTES_TRAFFIC_AWARE = original.traffic;
  if (original.timeout === undefined) delete process.env.GOOGLE_ROUTES_TIMEOUT_MS; else process.env.GOOGLE_ROUTES_TIMEOUT_MS = original.timeout;
  vi.unstubAllGlobals();
});

describe("quoteDeliveryWithGoogleRoutes", () => {
  it("uses the existing estimate when Google is disabled or has no key", async () => {
    process.env.GOOGLE_ROUTES_ENABLED = "false";
    process.env.GOOGLE_ROUTES_API_KEY = "";
    const quote = await quoteDeliveryWithGoogleRoutes(business, -2.135, -79.595);
    expect(quote.routeProvider).toBe("fallback");
    expect(quote.distanceKm).toBeGreaterThan(0);
  });

  it("uses Google's route distance and duration when the API succeeds", async () => {
    process.env.GOOGLE_ROUTES_ENABLED = "true";
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ routes: [{ distanceMeters: 4200, duration: "780s" }] }), { status: 200 })));
    const quote = await quoteDeliveryWithGoogleRoutes(business, -2.135, -79.595, { baseFee: 0.8, perKm: 0.3, perMinute: 0.04, minFee: 1.5, maxFee: 12 });
    expect(quote).toMatchObject({ routeProvider: "google", distanceKm: 4.2, estimatedMinutes: 13, distanceFee: 1.26, timeFee: 0.52 });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("computeRoutes"), expect.objectContaining({ method: "POST" }));
  });

  it("falls back when Google responds with an error", async () => {
    process.env.GOOGLE_ROUTES_ENABLED = "true";
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    const quote = await quoteDeliveryWithGoogleRoutes(business, -2.135, -79.595);
    expect(quote.routeProvider).toBe("fallback");
  });
});
