/**
 * Pruebas de integración (MySQL real): recargo por mal clima en la cotización y en el pedido.
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts). El clima se simula: no llama a OpenWeather.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("recargo por mal clima (MySQL real)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let appRouter: (typeof import("./router"))["appRouter"];
  let weatherLib: typeof import("./lib/weather");
  type Settings = Awaited<ReturnType<ReturnType<(typeof import("./router"))["appRouter"]["createCaller"]>["admin"]["financeSettings"]>>;
  let original: Settings;
  let admin: User;

  const realFetch = globalThis.fetch;
  /** Condición que "devuelve" OpenWeather; null = la consulta falla. */
  let owId: number | null = 800;

  const tag = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let seq = 0;
  const created = { users: [] as number[], businesses: [] as number[], products: [] as number[], orders: [] as number[] };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    process.env.GOOGLE_ROUTES_ENABLED = "false";
    process.env.WEATHER_ENABLED = "true";
    process.env.OPENWEATHER_API_KEY = "clave-de-prueba";
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (String(input).includes("openweathermap.org")) {
        if (owId === null) return new Response("error", { status: 500 });
        return new Response(JSON.stringify({ weather: [{ id: owId }] }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    db = (await import("./queries/connection")).getDb();
    S = await import("@db/schema");
    appRouter = (await import("./router")).appRouter;
    weatherLib = await import("./lib/weather");
    admin = await mkUser("admin");
    original = await callerFor(admin).admin.financeSettings();
  });

  beforeEach(() => {
    weatherLib.clearWeatherCache();
    owId = 800;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (!db) return;
    if (original) {
      await db.update(S.financeSettings).set({ weatherSurchargeMode: original.weatherSurchargeMode, weatherSurcharge: original.weatherSurcharge }).where(eq(S.financeSettings.id, 1));
    }
    if (created.orders.length) {
      await db.delete(S.orderItems).where(inArray(S.orderItems.orderId, created.orders));
      await db.delete(S.orderEvents).where(inArray(S.orderEvents.orderId, created.orders));
      await db.delete(S.orders).where(inArray(S.orders.id, created.orders));
    }
    if (created.products.length) await db.delete(S.products).where(inArray(S.products.id, created.products));
    if (created.businesses.length) await db.delete(S.businesses).where(inArray(S.businesses.id, created.businesses));
    if (created.users.length) await db.delete(S.users).where(inArray(S.users.id, created.users));
  });

  type User = Awaited<ReturnType<typeof mkUser>>;
  async function mkUser(kind: "customer" | "business" | "admin") {
    const [{ id }] = await db.insert(S.users).values({
      unionId: `${tag}-u${seq++}`, name: `${tag} ${kind}`,
      ...(kind === "admin" ? { role: "admin" as const } : { appRole: kind }),
    }).$returningId();
    created.users.push(id);
    return (await db.select().from(S.users).where(eq(S.users.id, id)))[0];
  }
  async function mkShop() {
    const owner = await mkUser("business");
    const [{ id: businessId }] = await db.insert(S.businesses).values({
      ownerId: owner.id, name: `${tag} local ${seq++}`, category: "test", address: "Calle 1", lat: -2.134, lng: -79.594,
      approvalStatus: "approved", locationConfirmed: true, isOpen: true, opensAt: "00:00", closesAt: "00:00",
    }).$returningId();
    created.businesses.push(businessId);
    const [{ id: productId }] = await db.insert(S.products).values({ businessId, name: `${tag} prod`, price: 3 }).$returningId();
    created.products.push(productId);
    return { businessId, productId };
  }
  const callerFor = (user: User) => appRouter.createCaller({ req: new Request("http://localhost/test"), resHeaders: new Headers(), user });
  async function failure(p: Promise<unknown>) {
    try { await p; } catch (e) { return e as { code: string; message: string }; }
    throw new Error("se esperaba un error y la operación tuvo éxito");
  }
  const dest = { lat: -2.139, lng: -79.588 };
  const configure = (mode: "off" | "heavy" | "rain", amount = 0.5) =>
    callerFor(admin).admin.updateFinanceSettings({
      serviceFee: original.serviceFee, courierDebtLimit: original.courierDebtLimit, businessDebtLimit: original.businessDebtLimit,
      deliveryBaseFee: original.deliveryBaseFee, deliveryPerKm: original.deliveryPerKm, deliveryPerMinute: original.deliveryPerMinute,
      minDeliveryFee: original.minDeliveryFee, maxDeliveryFee: original.maxDeliveryFee, dynamicPricingEnabled: original.dynamicPricingEnabled,
      weatherSurchargeMode: mode, weatherSurcharge: amount,
    });
  async function quote(shop: { businessId: number }) {
    return callerFor(await mkUser("customer")).orders.quote({ businessId: shop.businessId, ...dest });
  }
  async function order(shop: { businessId: number; productId: number }, expectedDeliveryFee?: number) {
    const res = await callerFor(await mkUser("customer")).orders.createDelivery({
      businessId: shop.businessId, items: [{ productId: shop.productId, quantity: 1 }], fulfillmentMethod: "delivery",
      deliveryAddress: "Av. Cliente 456", deliveryLat: dest.lat, deliveryLng: dest.lng, expectedDeliveryFee,
    });
    created.orders.push(res!.order.id);
    return res!.order;
  }

  it("desactivado: la lluvia fuerte no cambia el envío", async () => {
    const shop = await mkShop();
    await configure("off");
    owId = 502;
    const q = await quote(shop);
    expect([q.weatherFee, q.weatherCondition]).toEqual([0, null]);
  });

  it("con lluvia fuerte se suma el recargo a la cotización, al envío del pedido y al total", async () => {
    const shop = await mkShop();
    await configure("off");
    const base = await quote(shop);
    await configure("heavy", 0.5);
    owId = 502;
    weatherLib.clearWeatherCache();
    const q = await quote(shop);
    expect([q.weatherFee, q.weatherCondition]).toEqual([0.5, "heavy_rain"]);
    expect(q.fee).toBeCloseTo(base.fee + 0.5, 2);

    const o = await order(shop, q.fee);
    expect(o.deliveryFee).toBeCloseTo(base.fee + 0.5, 2);
    expect(o.total).toBeCloseTo(3 + base.fee + 0.5 + o.serviceFee, 2);
    expect(o.deliveryPricing).toMatchObject({ weatherFee: 0.5, weatherCondition: "heavy_rain" });
  });

  it("modo 'heavy' no cobra con lluvia ligera; modo 'rain' sí", async () => {
    const shop = await mkShop();
    owId = 500;
    await configure("heavy");
    expect((await quote(shop)).weatherFee).toBe(0);
    await configure("rain");
    weatherLib.clearWeatherCache();
    expect((await quote(shop)).weatherFee).toBe(0.5);
  });

  it("si no se puede consultar el clima, no se cobra", async () => {
    const shop = await mkShop();
    await configure("rain");
    owId = null;
    const q = await quote(shop);
    expect([q.weatherFee, q.weatherCondition]).toEqual([0, null]);
    expect((await order(shop)).deliveryPricing).not.toHaveProperty("weatherFee");
  });

  it("si el clima encareció el envío después de que el cliente lo vio, se le avisa en vez de cobrarle de más", async () => {
    const shop = await mkShop();
    await configure("off");
    const seen = await quote(shop); // el cliente vio este envío, sin recargo
    await configure("heavy");
    owId = 502;
    weatherLib.clearWeatherCache();
    const e = await failure(order(shop, seen.fee));
    expect(e.code).toBe("CONFLICT");
    const ok = await order(shop, seen.fee + 0.5); // con el envío actualizado, sí
    expect(ok.deliveryPricing).toMatchObject({ weatherFee: 0.5 });
  });

  it("solo el admin puede configurar el recargo y los valores se validan", async () => {
    const customer = await mkUser("customer");
    await expect(callerFor(customer).admin.updateFinanceSettings({
      serviceFee: 0.45, courierDebtLimit: 5, businessDebtLimit: 15, deliveryBaseFee: 0.8, deliveryPerKm: 0.3, deliveryPerMinute: 0.04,
      minDeliveryFee: 1.5, maxDeliveryFee: 12, dynamicPricingEnabled: false, weatherSurchargeMode: "heavy", weatherSurcharge: 5,
    })).rejects.toBeTruthy();
    await expect(configure("heavy", 99)).rejects.toBeTruthy();
  });
});
