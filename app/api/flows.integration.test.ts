/**
 * Pruebas de integración de los flujos críticos contra una base MySQL REAL.
 *
 * Solo corren si defines TEST_DATABASE_URL apuntando a una base de PRUEBAS (el nombre de la
 * base debe contener "test", por seguridad) con el esquema ya creado:
 *
 *   DATABASE_URL=mysql://root:pass@localhost:3306/rescate_test npm run db:push
 *   TEST_DATABASE_URL=mysql://root:pass@localhost:3306/rescate_test npm test
 *
 * Sin esa variable se omiten y `npm test` sigue funcionando solo con las pruebas unitarias.
 * Cada prueba crea sus propios datos (con un prefijo único) y los borra al terminar.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);
if (TEST_URL && !enabled) {
  console.warn(`[flows.integration] Se omite: la base "${dbName}" no contiene "test" en su nombre.`);
}

describe.skipIf(!enabled)("flujos críticos (MySQL real)", () => {
  // Se cargan después de fijar DATABASE_URL, porque el módulo de conexión lee el entorno al importarse.
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let appRouter: (typeof import("./router"))["appRouter"];
  let sweepOrders: (typeof import("./lib/maintenance"))["sweepOrders"];

  const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let seq = 0;
  const created = { users: [] as number[], businesses: [] as number[], packs: [] as number[], orders: [] as number[] };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    db = (await import("./queries/connection")).getDb();
    S = await import("@db/schema");
    appRouter = (await import("./router")).appRouter;
    sweepOrders = (await import("./lib/maintenance")).sweepOrders;
  });

  afterAll(async () => {
    if (!db) return;
    if (created.orders.length) {
      await db.delete(S.orderItems).where(inArray(S.orderItems.orderId, created.orders));
      await db.delete(S.orderEvents).where(inArray(S.orderEvents.orderId, created.orders));
      await db.delete(S.courierLocations).where(inArray(S.courierLocations.orderId, created.orders));
      await db.delete(S.orders).where(inArray(S.orders.id, created.orders));
    }
    if (created.packs.length) await db.delete(S.rescuePacks).where(inArray(S.rescuePacks.id, created.packs));
    if (created.businesses.length) await db.delete(S.businesses).where(inArray(S.businesses.id, created.businesses));
    if (created.users.length) await db.delete(S.users).where(inArray(S.users.id, created.users));
  });

  // ------------------------------------------------------------------ ayudantes
  async function mkUser(kind: "customer" | "business" | "courier") {
    const [{ id }] = await db
      .insert(S.users)
      .values({ unionId: `${tag}-u${seq++}`, name: `${tag} ${kind}`, appRole: kind, courierApproved: kind === "courier" })
      .$returningId();
    created.users.push(id);
    const [user] = await db.select().from(S.users).where(eq(S.users.id, id));
    return user;
  }

  async function mkBusiness(ownerId: number) {
    const [{ id }] = await db
      .insert(S.businesses)
      .values({ ownerId, name: `${tag} local`, category: "test", address: "Calle 1", lat: -2.134, lng: -79.594, approvalStatus: "approved" })
      .$returningId();
    created.businesses.push(id);
    return id;
  }

  /** Pack con ventana de 24 h (inicio = fin) para que no dependa de la hora en que corre la prueba. */
  async function mkPack(businessId: number, quantity: number) {
    const [{ id }] = await db
      .insert(S.rescuePacks)
      .values({
        businessId, title: `${tag} pack`, originalPrice: 10, rescuePrice: 4,
        quantityTotal: quantity, quantityLeft: quantity, pickupStart: "00:00", pickupEnd: "00:00",
      })
      .$returningId();
    created.packs.push(id);
    return id;
  }

  async function mkOrder(values: Partial<typeof S.orders.$inferInsert> & { customerId: number; businessId: number }) {
    const [{ id }] = await db
      .insert(S.orders)
      .values({ code: `${tag}-${seq++}`, type: "delivery", subtotal: 5, total: 6, deliveryFee: 1, deliveryAddress: "Calle 2", ...values })
      .$returningId();
    created.orders.push(id);
    return id;
  }

  const getOrder = async (id: number) => (await db.select().from(S.orders).where(eq(S.orders.id, id)))[0];
  const getPack = async (id: number) => (await db.select().from(S.rescuePacks).where(eq(S.rescuePacks.id, id)))[0];
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const callerFor = (user: Awaited<ReturnType<typeof mkUser>>) =>
    appRouter.createCaller({ req: new Request("http://localhost/test"), resHeaders: new Headers(), user });
  const fulfilled = (r: PromiseSettledResult<unknown>[]) => r.filter((x) => x.status === "fulfilled").length;

  // ------------------------------------------------------------------ cancelación
  describe("cancelación", () => {
    it("devuelve el stock del pack UNA sola vez aunque se cancele dos veces a la vez", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const packId = await mkPack(biz, 3);
      const c = callerFor(customer);

      const res = await c.orders.createRescue({ rescuePackId: packId, quantity: 2 });
      const orderId = res!.order.id;
      created.orders.push(orderId);
      expect((await getPack(packId)).quantityLeft).toBe(1);

      const results = await Promise.allSettled([c.orders.cancel({ id: orderId }), c.orders.cancel({ id: orderId })]);
      expect(fulfilled(results)).toBe(1);
      expect((await getOrder(orderId)).status).toBe("cancelled");
      expect((await getPack(packId)).quantityLeft).toBe(3); // 1 + 2 devueltos, no 5
    });

    it("el cliente no puede cancelar cuando el local ya está preparando", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, status: "preparing" });
      await expect(callerFor(customer).orders.cancel({ id: orderId })).rejects.toThrow(/empezó a prepararlo/);
      expect((await getOrder(orderId)).status).toBe("preparing");
    });

    it("otro cliente no puede cancelar un pedido ajeno", async () => {
      const owner = await mkUser("customer");
      const stranger = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const orderId = await mkOrder({ customerId: owner.id, businessId: biz, status: "pending" });
      await expect(callerFor(stranger).orders.cancel({ id: orderId })).rejects.toThrow(/No puedes cancelar/);
    });
  });

  // ------------------------------------------------------------------ reserva de packs
  describe("reserva de packs de rescate", () => {
    it("dos clientes a la vez por el último pack: solo uno se lo lleva", async () => {
      const a = await mkUser("customer");
      const b = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const packId = await mkPack(biz, 1);

      const results = await Promise.allSettled([
        callerFor(a).orders.createRescue({ rescuePackId: packId, quantity: 1 }),
        callerFor(b).orders.createRescue({ rescuePackId: packId, quantity: 1 }),
      ]);
      for (const r of results) if (r.status === "fulfilled" && r.value) created.orders.push(r.value.order.id);
      expect(fulfilled(results)).toBe(1);
      expect((await getPack(packId)).quantityLeft).toBe(0);
    });
  });

  // ------------------------------------------------------------------ toma atómica
  describe("toma de pedidos por repartidores", () => {
    it("si dos repartidores lo toman a la vez, solo uno gana", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const c1 = await mkUser("courier");
      const c2 = await mkUser("courier");
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, status: "ready", readyAt: new Date() });

      const results = await Promise.allSettled([
        callerFor(c1).courier.accept({ orderId }),
        callerFor(c2).courier.accept({ orderId }),
      ]);
      expect(fulfilled(results)).toBe(1);
      const winner = results[0].status === "fulfilled" ? c1 : c2;
      const order = await getOrder(orderId);
      expect(order.status).toBe("picked_up");
      expect(order.courierId).toBe(winner.id);
    });

    it("un repartidor con 2 entregas activas no puede tomar una tercera", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const courier = await mkUser("courier");
      for (let i = 0; i < 2; i++) {
        await mkOrder({ customerId: customer.id, businessId: biz, status: "picked_up", courierId: courier.id, courierAcceptedAt: new Date() });
      }
      const third = await mkOrder({ customerId: customer.id, businessId: biz, status: "ready", readyAt: new Date() });
      await expect(callerFor(courier).courier.accept({ orderId: third })).rejects.toThrow(/entregas activas/);
      expect((await getOrder(third)).courierId).toBeNull();
    });
  });

  // ------------------------------------------------------------------ soltar pedido
  describe("soltar pedido", () => {
    it("dentro de los primeros minutos vuelve a 'listo' sin repartidor", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const courier = await mkUser("courier");
      const orderId = await mkOrder({
        customerId: customer.id, businessId: biz, status: "picked_up", courierId: courier.id,
        courierAcceptedAt: new Date(), deliveryConfirmationCode: "123456",
      });
      await callerFor(courier).courier.release({ orderId, reason: "Se me averió la moto" });
      const order = await getOrder(orderId);
      expect(order.status).toBe("ready");
      expect(order.courierId).toBeNull();
      expect(order.deliveryConfirmationCode).toBeNull();
    });

    it("pasada la ventana ya no se puede soltar", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const courier = await mkUser("courier");
      const orderId = await mkOrder({
        customerId: customer.id, businessId: biz, status: "picked_up", courierId: courier.id, courierAcceptedAt: minutesAgo(10),
      });
      await expect(callerFor(courier).courier.release({ orderId, reason: "Ya no quiero" })).rejects.toThrow(/primeros 5 minutos/);
      const order = await getOrder(orderId);
      expect(order.status).toBe("picked_up");
      expect(order.courierId).toBe(courier.id);
    });
  });

  // ------------------------------------------------------------------ vencimientos
  describe("vencimientos automáticos (sweepOrders)", () => {
    it("cancela un pedido listo que ningún repartidor tomó en 20 min", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, status: "ready", readyAt: minutesAgo(25) });
      await sweepOrders();
      const order = await getOrder(orderId);
      expect(order.status).toBe("cancelled");
      expect(order.cancelledBy).toBe("system");
    });

    it("cancela un pedido pendiente que el local no aceptó en 15 min", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, status: "pending", createdAt: minutesAgo(20) });
      await sweepOrders();
      expect((await getOrder(orderId)).status).toBe("cancelled");
    });

    it("no toca pedidos recientes", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const pending = await mkOrder({ customerId: customer.id, businessId: biz, status: "pending" });
      const ready = await mkOrder({ customerId: customer.id, businessId: biz, status: "ready", readyAt: minutesAgo(2) });
      await sweepOrders();
      expect((await getOrder(pending)).status).toBe("pending");
      expect((await getOrder(ready)).status).toBe("ready");
    });

    it("avisa una sola vez a los repartidores a los 8 min, sin cancelar", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, status: "ready", readyAt: minutesAgo(10) });
      await sweepOrders();
      const first = await getOrder(orderId);
      expect(first.status).toBe("ready");
      expect(first.courierReminderSentAt).not.toBeNull();
      const sentAt = first.courierReminderSentAt!.getTime();
      await sweepOrders();
      expect((await getOrder(orderId)).courierReminderSentAt!.getTime()).toBe(sentAt); // no se repite
    });
  });
});
