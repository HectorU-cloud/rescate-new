/**
 * Pruebas de integración (MySQL real): la tarifa de servicio y los topes del envío salen de la configuración del
 * admin, y cada pedido guarda cómo se calculó su precio.
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts).
 * OJO: modifican la fila única de configuración financiera y la restauran al terminar.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("tarifas configurables y desglose del precio (MySQL real)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let appRouter: (typeof import("./router"))["appRouter"];
  type Settings = Awaited<ReturnType<ReturnType<(typeof appRouter)["createCaller"]>["admin"]["financeSettings"]>>;
  let original: Settings;

  const tag = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let seq = 0;
  const created = { users: [] as number[], businesses: [] as number[], products: [] as number[], orders: [] as number[] };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    process.env.GOOGLE_ROUTES_ENABLED = "false"; // cotiza con el cálculo aproximado, sin llamar a Google
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    db = (await import("./queries/connection")).getDb();
    S = await import("@db/schema");
    appRouter = (await import("./router")).appRouter;
    const admin = await mkUser("admin");
    original = await callerFor(admin).admin.financeSettings();
  });

  afterAll(async () => {
    if (!db) return;
    if (original) {
      await db.update(S.financeSettings).set({
        serviceFee: original.serviceFee, deliveryBaseFee: original.deliveryBaseFee, deliveryPerKm: original.deliveryPerKm,
        deliveryPerMinute: original.deliveryPerMinute, minDeliveryFee: original.minDeliveryFee, maxDeliveryFee: original.maxDeliveryFee,
      }).where(eq(S.financeSettings.id, 1));
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

  // ------------------------------------------------------------------ ayudantes
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
  const dest = { deliveryLat: -2.139, deliveryLng: -79.588 };
  /** Guarda tarifas (el resto de campos queda como estaba). */
  const configure = async (admin: User, over: Partial<Pick<Settings, "serviceFee" | "minDeliveryFee" | "maxDeliveryFee">>) =>
    callerFor(admin).admin.updateFinanceSettings({
      serviceFee: original.serviceFee, courierDebtLimit: original.courierDebtLimit, businessDebtLimit: original.businessDebtLimit,
      deliveryBaseFee: original.deliveryBaseFee, deliveryPerKm: original.deliveryPerKm, deliveryPerMinute: original.deliveryPerMinute,
      minDeliveryFee: original.minDeliveryFee, maxDeliveryFee: original.maxDeliveryFee, dynamicPricingEnabled: original.dynamicPricingEnabled,
      ...over,
    });
  async function order(shop: { businessId: number; productId: number }, method: "delivery" | "pickup") {
    const customer = await mkUser("customer");
    const res = await callerFor(customer).orders.createDelivery({
      businessId: shop.businessId, items: [{ productId: shop.productId, quantity: 1 }], fulfillmentMethod: method,
      ...(method === "delivery" ? { deliveryAddress: "Av. Cliente 456", ...dest } : {}),
    });
    created.orders.push(res!.order.id);
    return res!.order;
  }
  const row = async (id: number) => (await db.select().from(S.orders).where(eq(S.orders.id, id)))[0];

  // ------------------------------------------------------------------ pruebas
  it("la tarifa de servicio del admin es la que se muestra y la que se cobra (retiro en local)", async () => {
    const admin = await mkUser("admin");
    const shop = await mkShop();
    await configure(admin, { serviceFee: 0.77 });
    expect((await appRouter.createCaller({ req: new Request("http://localhost/t"), resHeaders: new Headers(), user: undefined as never }).orders.fees()).serviceFee).toBe(0.77);

    const o = await order(shop, "pickup");
    expect(o.serviceFee).toBe(0.77);
    expect(o.deliveryFee).toBe(0);
    expect(o.total).toBeCloseTo(3.77, 2);
    expect(o.deliveryPricing).toMatchObject({ fulfillment: "pickup", deliveryFee: 0, serviceFee: 0.77, formulaVersion: 1, provider: null });
  });

  it("el envío respeta el mínimo configurado y el pedido guarda el desglose completo", async () => {
    const admin = await mkUser("admin");
    const shop = await mkShop();
    await configure(admin, { serviceFee: 0.77, minDeliveryFee: 4, maxDeliveryFee: 12 });

    const quote = await callerFor(await mkUser("customer")).orders.quote({ businessId: shop.businessId, lat: dest.deliveryLat, lng: dest.deliveryLng });
    expect(quote).toMatchObject({ fee: 4, clamp: "min", serviceFee: 0.77 });

    const o = await order(shop, "delivery");
    expect(o.deliveryFee).toBe(4);
    expect(o.total).toBeCloseTo(3 + 4 + 0.77, 2);
    const p = o.deliveryPricing!;
    expect(p).toMatchObject({ fulfillment: "delivery", provider: "fallback", clamp: "min", minFee: 4, maxFee: 12, deliveryFee: 4, serviceFee: 0.77 });
    expect(p.rawFee!).toBeLessThan(4);
    expect(Math.abs(p.baseFee! + p.distanceFee! + p.timeFee! - p.rawFee!)).toBeLessThan(0.02);
    expect(p.distanceKm).toBe(o.deliveryDistanceKm);
  });

  it("el envío respeta el máximo configurado", async () => {
    const admin = await mkUser("admin");
    const shop = await mkShop();
    await configure(admin, { minDeliveryFee: 0.5, maxDeliveryFee: 1 });
    const o = await order(shop, "delivery");
    expect(o.deliveryFee).toBe(1);
    expect(o.deliveryPricing).toMatchObject({ clamp: "max", maxFee: 1, deliveryFee: 1 });
  });

  it("cambiar la configuración después no altera lo que aceptó el cliente, y los pedidos nuevos usan la nueva", async () => {
    const admin = await mkUser("admin");
    const shop = await mkShop();
    await configure(admin, { serviceFee: 0.5, minDeliveryFee: 2, maxDeliveryFee: 12 });
    const before = await order(shop, "delivery");

    await configure(admin, { serviceFee: 1.1, minDeliveryFee: 6, maxDeliveryFee: 12 });
    const after = await row(before.id);
    expect(after).toMatchObject({ serviceFee: 0.5, deliveryFee: before.deliveryFee, total: before.total });
    expect(after.deliveryPricing).toEqual(before.deliveryPricing);

    const next = await order(shop, "delivery");
    expect(next.serviceFee).toBe(1.1);
    expect(next.deliveryFee).toBe(6);
  });

  it("rechaza topes incoherentes y solo un admin puede cambiar las tarifas", async () => {
    const admin = await mkUser("admin");
    const bad = await failure(configure(admin, { minDeliveryFee: 5, maxDeliveryFee: 3 }));
    expect(bad.code).toBe("BAD_REQUEST");
    expect(bad.message).toMatch(/máximo/);
    const customer = await mkUser("customer");
    expect((await failure(configure(customer, { serviceFee: 0.1 }))).code).toBe("FORBIDDEN");
  });
});
