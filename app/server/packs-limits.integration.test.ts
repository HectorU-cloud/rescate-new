/**
 * Pruebas de integración (MySQL real): vencimiento de packs de rescate y límites de pedidos por cliente.
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { computePackExpiry } from "@contracts/packs";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("packs con fecha y límites por cliente (MySQL real)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let appRouter: (typeof import("./router"))["appRouter"];

  const tag = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let seq = 0;
  const created = { users: [] as number[], businesses: [] as number[], orders: [] as number[], products: [] as number[], packs: [] as number[] };
  const HOUR = 3600_000;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    db = (await import("./queries/connection")).getDb();
    S = await import("@db/schema");
    appRouter = (await import("./router")).appRouter;
  });

  afterAll(async () => {
    if (!db) return;
    if (created.orders.length) {
      await db.delete(S.orderItems).where(inArray(S.orderItems.orderId, created.orders));
      await db.delete(S.orderEvents).where(inArray(S.orderEvents.orderId, created.orders));
      await db.delete(S.orders).where(inArray(S.orders.id, created.orders));
    }
    if (created.packs.length) await db.delete(S.rescuePacks).where(inArray(S.rescuePacks.id, created.packs));
    if (created.products.length) await db.delete(S.products).where(inArray(S.products.id, created.products));
    if (created.businesses.length) await db.delete(S.businesses).where(inArray(S.businesses.id, created.businesses));
    if (created.users.length) await db.delete(S.users).where(inArray(S.users.id, created.users));
  });

  // ------------------------------------------------------------------ ayudantes
  type User = Awaited<ReturnType<typeof mkUser>>;
  async function mkUser(kind: "customer" | "business") {
    const [{ id }] = await db.insert(S.users).values({ unionId: `${tag}-u${seq++}`, name: `${tag} ${kind}`, appRole: kind }).$returningId();
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
  async function mkProduct(businessId: number) {
    const [{ id }] = await db.insert(S.products).values({ businessId, name: `${tag} prod`, price: 3 }).$returningId();
    created.products.push(id);
    return id;
  }
  /** Pack con ventana de 24 h; `expiresAt` por defecto dentro de 12 horas. */
  async function mkPack(businessId: number, over: Partial<typeof S.rescuePacks.$inferInsert> = {}) {
    const [{ id }] = await db.insert(S.rescuePacks).values({
      businessId, title: `${tag} pack ${seq++}`, originalPrice: 10, rescuePrice: 4, quantityTotal: 50, quantityLeft: 50,
      pickupStart: "00:00", pickupEnd: "00:00", expiresAt: new Date(Date.now() + 12 * HOUR), ...over,
    }).$returningId();
    created.packs.push(id);
    return id;
  }
  async function mkOrder(customerId: number, businessId: number, status: (typeof S.orders.$inferInsert)["status"], over: Partial<typeof S.orders.$inferInsert> = {}) {
    const [{ id }] = await db.insert(S.orders).values({
      code: `${tag}-${seq++}`, type: "delivery", status, customerId, businessId, subtotal: 5, total: 6, deliveryFee: 1, deliveryAddress: "Calle 2", ...over,
    }).$returningId();
    created.orders.push(id);
    return id;
  }
  const getPack = async (id: number) => (await db.select().from(S.rescuePacks).where(eq(S.rescuePacks.id, id)))[0];
  const callerFor = (user: User) => appRouter.createCaller({ req: new Request("http://localhost/test"), resHeaders: new Headers(), user });
  async function failure(p: Promise<unknown>) {
    try { await p; } catch (e) { return e as { code: string; message: string }; }
    throw new Error("se esperaba un error y la operación tuvo éxito");
  }
  const dest = { deliveryLat: -2.139, deliveryLng: -79.588 };
  const delivery = (c: ReturnType<typeof callerFor>, businessId: number, productId: number) =>
    c.orders.createDelivery({ businessId, items: [{ productId, quantity: 1 }], deliveryAddress: "Av. Cliente 456", ...dest });

  // ================================================================== PACKS
  describe("packs con fecha de vencimiento", () => {
    it("al publicar un pack se guarda cuándo vence (próximo fin de ventana) y no aparece como vencido", async () => {
      const owner = await mkUser("business"); await mkBusiness(owner.id);
      const before = Date.now();
      const { id } = await callerFor(owner).business.createRescuePack({ title: `${tag} nuevo`, originalPrice: 6, rescuePrice: 2, quantityTotal: 4, pickupStart: "19:00", pickupEnd: "20:30" });
      created.packs.push(id);
      const pack = await getPack(id);
      expect(pack.expiresAt).not.toBeNull();
      expect(pack.expiresAt!.getTime()).toBeGreaterThan(before);
      expect(pack.expiresAt!.getTime() - before).toBeLessThanOrEqual(24 * HOUR + 1000);
      expect(Math.abs(pack.expiresAt!.getTime() - computePackExpiry("19:00", "20:30").getTime())).toBeLessThan(5000);
      const mine = (await callerFor(owner).business.rescuePacks()).find((p) => p.id === id)!;
      expect(mine.expired).toBe(false);
    });

    it("un pack vencido no se muestra ni en el catálogo ni en la ficha del local", async () => {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      const live = await mkPack(biz);
      const dead = await mkPack(biz, { expiresAt: new Date(Date.now() - 1000) });
      const c = callerFor(await mkUser("customer"));
      const catalog = (await c.catalog.rescuePacks()).map((r) => r.pack.id);
      expect(catalog).toContain(live);
      expect(catalog).not.toContain(dead);
      const detail = await c.catalog.businessDetail({ id: biz });
      expect(detail!.rescuePacks.map((p) => p.id)).toEqual([live]);
      expect(detail!.rescuePacks[0].reservable).toBe(true);
    });

    it("un pack de antes de existir el vencimiento (sin fecha) cuenta como vencido", async () => {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      const legacy = await mkPack(biz, { expiresAt: null });
      const c = callerFor(await mkUser("customer"));
      expect((await c.catalog.rescuePacks()).map((r) => r.pack.id)).not.toContain(legacy);
      expect((await failure(c.orders.createRescue({ rescuePackId: legacy, quantity: 1 }))).message).toMatch(/venci/i);
    });

    it("no se puede reservar un pack vencido y el stock no cambia", async () => {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      const dead = await mkPack(biz, { expiresAt: new Date(Date.now() - 60_000), quantityLeft: 7, quantityTotal: 7 });
      const e = await failure(callerFor(await mkUser("customer")).orders.createRescue({ rescuePackId: dead, quantity: 2 }));
      expect(e.code).toBe("BAD_REQUEST");
      expect(e.message).toMatch(/venci/i);
      expect((await getPack(dead)).quantityLeft).toBe(7);
    });

    it("un pack vigente se reserva con normalidad", async () => {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      const pack = await mkPack(biz, { quantityLeft: 5 });
      const order = await callerFor(await mkUser("customer")).orders.createRescue({ rescuePackId: pack, quantity: 2 });
      created.orders.push(order!.order.id);
      expect((await getPack(pack)).quantityLeft).toBe(3);
    });

    it("pausar es posible, pero reactivar un pack vencido exige republicarlo", async () => {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      const dead = await mkPack(biz, { expiresAt: new Date(Date.now() - 1000), isActive: false });
      const e = await failure(callerFor(owner).business.toggleRescuePack({ id: dead, isActive: true }));
      expect(e.code).toBe("PRECONDITION_FAILED");
      expect(e.message).toMatch(/Republicar/);
      const live = await mkPack(biz);
      expect((await callerFor(owner).business.toggleRescuePack({ id: live, isActive: false })).ok).toBe(true);
      expect((await callerFor(owner).business.toggleRescuePack({ id: live, isActive: true })).ok).toBe(true);
    });

    it("republicar da nuevo vencimiento, repone el stock y lo vuelve a mostrar", async () => {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      const pack = await mkPack(biz, { expiresAt: new Date(Date.now() - 1000), quantityTotal: 6, quantityLeft: 0, isActive: false, pickupStart: "19:00", pickupEnd: "20:30" });
      const r = await callerFor(owner).business.republishRescuePack({ id: pack });
      const after = await getPack(pack);
      expect(after.isActive).toBe(true);
      expect([after.quantityTotal, after.quantityLeft]).toEqual([6, 6]);
      expect(after.expiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(Math.abs(after.expiresAt!.getTime() - computePackExpiry("19:00", "20:30").getTime())).toBeLessThan(5000);
      expect(r.expiresAt.getTime()).toBe(after.expiresAt!.getTime());
      expect((await callerFor(await mkUser("customer")).catalog.rescuePacks()).map((x) => x.pack.id)).toContain(pack);
    });

    it("republicar puede cambiar la cantidad", async () => {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      const pack = await mkPack(biz, { expiresAt: new Date(Date.now() - 1000), quantityTotal: 6, quantityLeft: 1 });
      await callerFor(owner).business.republishRescuePack({ id: pack, quantity: 9 });
      expect([(await getPack(pack)).quantityTotal, (await getPack(pack)).quantityLeft]).toEqual([9, 9]);
    });

    it("solo el dueño del local puede republicar o activar sus packs", async () => {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      const other = await mkUser("business"); await mkBusiness(other.id);
      const pack = await mkPack(biz, { expiresAt: new Date(Date.now() - 1000), quantityLeft: 0 });
      expect((await failure(callerFor(other).business.republishRescuePack({ id: pack }))).code).toBe("NOT_FOUND");
      expect((await failure(callerFor(other).business.toggleRescuePack({ id: pack, isActive: false }))).code).toBe("NOT_FOUND");
      expect((await getPack(pack)).quantityLeft).toBe(0);
    });

    it("el panel del local marca cuáles packs vencieron", async () => {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      const live = await mkPack(biz); const dead = await mkPack(biz, { expiresAt: new Date(Date.now() - 1000) }); const legacy = await mkPack(biz, { expiresAt: null });
      const flags = Object.fromEntries((await callerFor(owner).business.rescuePacks()).map((p) => [p.id, p.expired]));
      expect([flags[live], flags[dead], flags[legacy]]).toEqual([false, true, true]);
    });
  });

  // ================================================================== LÍMITES
  describe("límites de pedidos por cliente", () => {
    async function setup() {
      const owner = await mkUser("business"); const biz = await mkBusiness(owner.id);
      return { biz, prod: await mkProduct(biz), pack: await mkPack(biz), customer: await mkUser("customer") };
    }

    it("con 5 pedidos en curso no se puede hacer otro (delivery ni rescate)", async () => {
      const { biz, prod, pack, customer } = await setup();
      for (const s of ["accepted", "accepted", "preparing", "ready", "picked_up"] as const) await mkOrder(customer.id, biz, s);
      const c = callerFor(customer);
      const e1 = await failure(delivery(c, biz, prod));
      expect([e1.code, e1.message]).toEqual(["TOO_MANY_REQUESTS", expect.stringMatching(/pedidos en curso/)]);
      expect((await failure(c.orders.createRescue({ rescuePackId: pack, quantity: 1 }))).code).toBe("TOO_MANY_REQUESTS");
      expect((await getPack(pack)).quantityLeft).toBe(50); // el rechazo no gasta stock
    });

    it("los pedidos entregados o cancelados no cuentan como en curso", async () => {
      const { biz, prod, customer } = await setup();
      for (const s of ["delivered", "delivered", "cancelled", "cancelled"] as const) await mkOrder(customer.id, biz, s);
      for (const s of ["accepted", "accepted", "preparing", "ready"] as const) await mkOrder(customer.id, biz, s);
      const o = await delivery(callerFor(customer), biz, prod);
      created.orders.push(o!.order.id);
      expect(o!.order.status).toBe("pending");
    });

    it("con 3 pedidos esperando respuesta no se puede pedir más, y cancelar uno libera el cupo", async () => {
      const { biz, prod, customer } = await setup();
      const ids = [await mkOrder(customer.id, biz, "pending"), await mkOrder(customer.id, biz, "pending"), await mkOrder(customer.id, biz, "pending")];
      const c = callerFor(customer);
      const e = await failure(delivery(c, biz, prod));
      expect([e.code, e.message]).toEqual(["TOO_MANY_REQUESTS", expect.stringMatching(/esperando respuesta/)]);
      await c.orders.cancel({ id: ids[0] });
      const ok = await delivery(c, biz, prod);
      created.orders.push(ok!.order.id);
      expect(ok!.order.status).toBe("pending");
    });

    it("máximo 12 pedidos por hora; los de hace más de una hora no cuentan", async () => {
      const { biz, prod, customer } = await setup();
      const old: number[] = [];
      for (let i = 0; i < 12; i++) old.push(await mkOrder(customer.id, biz, "delivered"));
      const e = await failure(delivery(callerFor(customer), biz, prod));
      expect([e.code, e.message]).toEqual(["TOO_MANY_REQUESTS", expect.stringMatching(/última hora/)]);
      await db.update(S.orders).set({ createdAt: sql`NOW() - INTERVAL 2 HOUR` }).where(inArray(S.orders.id, old));
      const ok = await delivery(callerFor(customer), biz, prod);
      created.orders.push(ok!.order.id);
      expect(ok!.order.id).toBeGreaterThan(0);
    });

    it("el límite es por cliente: otro cliente sigue pudiendo pedir", async () => {
      const { biz, prod, customer } = await setup();
      for (let i = 0; i < 5; i++) await mkOrder(customer.id, biz, "accepted");
      await failure(delivery(callerFor(customer), biz, prod));
      const other = await mkUser("customer");
      const ok = await delivery(callerFor(other), biz, prod);
      created.orders.push(ok!.order.id);
      expect(ok!.order.customerId).toBe(other.id);
    });

    it("20 rescates simultáneos del mismo cliente: pasan solo 5 y el stock baja exactamente 5", async () => {
      const { pack, customer } = await setup();
      const c = callerFor(customer);
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => c.orders.createRescue({ rescuePackId: pack, quantity: 1 })));
      const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ order: { id: number } } | null>[];
      ok.forEach((r) => created.orders.push(r.value!.order.id));
      expect(ok).toHaveLength(5);
      expect(results.filter((r) => r.status === "rejected" && (r.reason as { code: string }).code === "TOO_MANY_REQUESTS")).toHaveLength(15);
      expect((await getPack(pack)).quantityLeft).toBe(45);
    });

    it("20 pedidos de delivery simultáneos del mismo cliente: pasan solo 3 (los que esperan respuesta)", async () => {
      const { biz, prod, customer } = await setup();
      const c = callerFor(customer);
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => delivery(c, biz, prod)));
      const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ order: { id: number } } | null>[];
      ok.forEach((r) => created.orders.push(r.value!.order.id));
      expect(ok).toHaveLength(3);
      expect(await db.select().from(S.orders).where(eq(S.orders.customerId, customer.id))).toHaveLength(3);
    });
  });
});
