/**
 * Pruebas de integración (MySQL real): estado de cuenta, límite de deuda y tiempo de preparación.
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("estado de cuenta, límite de deuda y preparación (MySQL real)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let appRouter: (typeof import("./router"))["appRouter"];
  let limits: { courier: number; business: number };

  const tag = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let seq = 0;
  const created = { users: [] as number[], businesses: [] as number[], orders: [] as number[] };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    db = (await import("./queries/connection")).getDb();
    S = await import("@db/schema");
    appRouter = (await import("./router")).appRouter;
    limits = await (await import("./lib/wallet")).getDebtLimits();
  });

  afterAll(async () => {
    if (!db) return;
    if (created.users.length) await db.delete(S.walletEntries).where(and(eq(S.walletEntries.walletType, "courier"), inArray(S.walletEntries.walletId, created.users)));
    if (created.businesses.length) await db.delete(S.walletEntries).where(and(eq(S.walletEntries.walletType, "business"), inArray(S.walletEntries.walletId, created.businesses)));
    if (created.orders.length) {
      await db.delete(S.orderEvents).where(inArray(S.orderEvents.orderId, created.orders));
      await db.delete(S.orders).where(inArray(S.orders.id, created.orders));
    }
    if (created.businesses.length) await db.delete(S.businesses).where(inArray(S.businesses.id, created.businesses));
    if (created.users.length) await db.delete(S.users).where(inArray(S.users.id, created.users));
  });

  type User = Awaited<ReturnType<typeof mkUser>>;
  async function mkUser(kind: "customer" | "business" | "courier") {
    const [{ id }] = await db.insert(S.users).values({ unionId: `${tag}-u${seq++}`, name: `${tag} ${kind}`, appRole: kind, courierApproved: kind === "courier" }).$returningId();
    created.users.push(id);
    return (await db.select().from(S.users).where(eq(S.users.id, id)))[0];
  }
  async function mkBusiness(ownerId: number) {
    const [{ id }] = await db.insert(S.businesses).values({
      ownerId, name: `${tag} local ${seq++}`, category: "test", address: "Calle 1", lat: -2.134, lng: -79.594,
      approvalStatus: "approved", locationConfirmed: true, isOpen: true, opensAt: "00:00", closesAt: "00:00",
    }).$returningId();
    created.businesses.push(id);
    return id;
  }
  async function mkOrder(customerId: number, businessId: number, status: "pending" | "ready") {
    const [{ id }] = await db.insert(S.orders).values({
      code: `${tag}-${seq++}`, type: "delivery", fulfillmentMethod: "delivery", subtotal: 5, total: 6, deliveryFee: 1,
      deliveryAddress: "Calle 2", customerId, businessId, status,
    }).$returningId();
    created.orders.push(id);
    return id;
  }
  const callerFor = (user: User) => appRouter.createCaller({ req: new Request("http://localhost/test"), resHeaders: new Headers(), user });
  async function failure(p: Promise<unknown>) {
    try { await p; } catch (e) { return e as { code: string; message: string }; }
    throw new Error("se esperaba un error y la operación tuvo éxito");
  }
  const charge = (walletType: "courier" | "business", walletId: number, amount: number, entryType: "charge" | "payment" = "charge", status: "confirmed" | "pending" = "confirmed") =>
    db.insert(S.walletEntries).values({ walletType, walletId, entryType, amount, status, description: `${tag} movimiento` });

  it("el repartidor ve su saldo y sus movimientos (sin datos internos); un cliente no tiene estado de cuenta", async () => {
    const courier = await mkUser("courier");
    await charge("courier", courier.id, 0.45);
    await charge("courier", courier.id, 0.45);
    await charge("courier", courier.id, 0.5, "payment");
    await charge("courier", courier.id, 9, "payment", "pending");
    const w = (await callerFor(courier).wallet.mine())!;
    expect([w.walletType, w.balance, w.pendingPayments]).toEqual(["courier", 0.4, 9]);
    expect(w.entries).toHaveLength(4);
    expect("createdBy" in w.entries[0]).toBe(false);
    expect(await callerFor(await mkUser("customer")).wallet.mine()).toBeNull();
  });

  it("con deuda por encima del límite el repartidor no puede tomar pedidos; al confirmarse un pago, sí", async () => {
    if (!(limits.courier > 0)) return; // límite desactivado en esta base de pruebas
    const owner = await mkUser("business");
    const biz = await mkBusiness(owner.id);
    const customer = await mkUser("customer");
    const courier = await mkUser("courier");
    await charge("courier", courier.id, limits.courier + 1);
    const orderId = await mkOrder(customer.id, biz, "ready");

    const blocked = await failure(callerFor(courier).courier.accept({ orderId }));
    expect(blocked.code).toBe("PRECONDITION_FAILED");
    expect((await callerFor(courier).wallet.mine())!.state).toBe("blocked");

    await charge("courier", courier.id, 5, "payment", "pending"); // un pago sin verificar no desbloquea
    expect((await failure(callerFor(courier).courier.accept({ orderId }))).code).toBe("PRECONDITION_FAILED");

    await charge("courier", courier.id, 2, "payment"); // pago confirmado por el admin
    await expect(callerFor(courier).courier.accept({ orderId })).resolves.toEqual({ ok: true });
  });

  it("el comercio con deuda por encima del límite no puede aceptar pedidos nuevos", async () => {
    if (!(limits.business > 0)) return;
    const owner = await mkUser("business");
    const biz = await mkBusiness(owner.id);
    const customer = await mkUser("customer");
    await charge("business", biz, limits.business + 1);
    const orderId = await mkOrder(customer.id, biz, "pending");
    const blocked = await failure(callerFor(owner).business.updateOrderStatus({ orderId, status: "accepted", prepMinutes: 15 }));
    expect(blocked.code).toBe("PRECONDITION_FAILED");
    await charge("business", biz, 3, "payment");
    await expect(callerFor(owner).business.updateOrderStatus({ orderId, status: "accepted", prepMinutes: 15 })).resolves.toEqual({ ok: true });
  });

  it("al aceptar un pedido a domicilio se guarda el tiempo de preparación y la hora estimada", async () => {
    const owner = await mkUser("business");
    const biz = await mkBusiness(owner.id);
    const customer = await mkUser("customer");
    const orderId = await mkOrder(customer.id, biz, "pending");
    const before = Date.now();
    await callerFor(owner).business.updateOrderStatus({ orderId, status: "accepted", prepMinutes: 20 });
    const [o] = await db.select().from(S.orders).where(eq(S.orders.id, orderId));
    expect(o.prepMinutes).toBe(20);
    expect(Math.abs(o.estimatedReadyAt!.getTime() - (before + 20 * 60_000))).toBeLessThan(10_000);
  });

  it("rechaza tiempos de preparación absurdos", async () => {
    const owner = await mkUser("business");
    const biz = await mkBusiness(owner.id);
    const customer = await mkUser("customer");
    const orderId = await mkOrder(customer.id, biz, "pending");
    await expect(callerFor(owner).business.updateOrderStatus({ orderId, status: "accepted", prepMinutes: 600 })).rejects.toBeTruthy();
  });
});
