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
import { bayesianRating, startOfDayEcuador } from "./lib/business-rules";

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
      await db.delete(S.orderMessages).where(inArray(S.orderMessages.orderId, created.orders));
      await db.delete(S.ratings).where(inArray(S.ratings.orderId, created.orders));
      await db.delete(S.claims).where(inArray(S.claims.orderId, created.orders));
      await db.delete(S.courierLocations).where(inArray(S.courierLocations.orderId, created.orders));
      await db.delete(S.orders).where(inArray(S.orders.id, created.orders));
    }
    if (created.packs.length) await db.delete(S.rescuePacks).where(inArray(S.rescuePacks.id, created.packs));
    if (created.businesses.length) await db.delete(S.businesses).where(inArray(S.businesses.id, created.businesses));
    if (created.users.length) await db.delete(S.customerAddresses).where(inArray(S.customerAddresses.userId, created.users));
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

  async function mkAdmin() {
    const user = await mkUser("customer");
    await db.update(S.users).set({ role: "admin" }).where(eq(S.users.id, user.id));
    const [admin] = await db.select().from(S.users).where(eq(S.users.id, user.id));
    return admin;
  }

  async function mkBusiness(ownerId: number, over: Partial<typeof S.businesses.$inferInsert> = {}) {
    const [{ id }] = await db
      .insert(S.businesses)
      .values({ ownerId, name: `${tag} local`, category: "test", address: "Calle 1", lat: -2.134, lng: -79.594, approvalStatus: "approved", locationConfirmed: true, ...over })
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

  // ------------------------------------------------------------------ chat cliente ↔ repartidor
  describe("chat cliente–repartidor", () => {
    /** Pedido en camino con cliente, comercio y repartidor listos para chatear. */
    async function setupChat(overrides: Partial<typeof S.orders.$inferInsert> = {}) {
      const customer = await mkUser("customer");
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const courier = await mkUser("courier");
      const orderId = await mkOrder({
        customerId: customer.id, businessId: biz, status: "picked_up", courierId: courier.id,
        courierAcceptedAt: new Date(), deliveryConfirmationCode: "482913", ...overrides,
      });
      return { customer, owner, courier, orderId };
    }
    const messagesOf = async (orderId: number) => db.select().from(S.orderMessages).where(eq(S.orderMessages.orderId, orderId));

    it("cliente y repartidor intercambian mensajes y ambos los ven", async () => {
      const { customer, courier, orderId } = await setupChat();
      await callerFor(customer).chat.send({ orderId, body: "Hola, estoy en la puerta azul" });
      await callerFor(courier).chat.send({ orderId, body: "Perfecto, llego en 3 minutos" });

      const asCustomer = await callerFor(customer).chat.list({ orderId });
      const asCourier = await callerFor(courier).chat.list({ orderId });
      expect(asCustomer.role).toBe("customer");
      expect(asCourier.role).toBe("courier");
      expect(asCustomer.canSend).toBe(true);
      expect(asCustomer.messages.map((m) => m.body)).toEqual(["Hola, estoy en la puerta azul", "Perfecto, llego en 3 minutos"]);
      expect(asCourier.messages).toHaveLength(2);
      expect(asCustomer.messages.map((m) => m.senderRole)).toEqual(["customer", "courier"]);
    });

    it("un tercero no puede leer ni escribir en el chat", async () => {
      const { orderId } = await setupChat();
      const stranger = await mkUser("customer");
      await expect(callerFor(stranger).chat.list({ orderId })).rejects.toThrow(/No puedes acceder al chat/);
      await expect(callerFor(stranger).chat.send({ orderId, body: "hola" })).rejects.toThrow(/No puedes acceder al chat/);
      await expect(callerFor(stranger).chat.markRead({ orderId })).rejects.toThrow(/No puedes acceder al chat/);
      expect(await messagesOf(orderId)).toHaveLength(0);
    });

    it("el dueño del comercio no participa en el chat", async () => {
      const { owner, orderId } = await setupChat();
      await expect(callerFor(owner).chat.send({ orderId, body: "hola" })).rejects.toThrow(/No puedes acceder al chat/);
      await expect(callerFor(owner).chat.list({ orderId })).rejects.toThrow(/No puedes acceder al chat/);
    });

    it("no se puede escribir si el pedido no está en camino", async () => {
      for (const status of ["ready", "delivered", "cancelled"] as const) {
        const { customer, orderId } = await setupChat({ status });
        await expect(callerFor(customer).chat.send({ orderId, body: "hola" })).rejects.toThrow(/solo mientras el pedido va en camino/);
      }
    });

    it("una vez entregado, queda el historial de solo lectura", async () => {
      const { customer, courier, orderId } = await setupChat();
      await callerFor(courier).chat.send({ orderId, body: "Ya estoy afuera" });
      await db.update(S.orders).set({ status: "delivered", deliveredAt: new Date() }).where(eq(S.orders.id, orderId));
      const list = await callerFor(customer).chat.list({ orderId });
      expect(list.canSend).toBe(false);
      expect(list.messages).toHaveLength(1);
      await expect(callerFor(customer).chat.send({ orderId, body: "gracias" })).rejects.toThrow(/solo mientras el pedido va en camino/);
    });

    it("rechaza mensajes que contienen el código de confirmación (aunque vaya con espacios)", async () => {
      const { customer, orderId } = await setupChat();
      const c = callerFor(customer);
      await expect(c.chat.send({ orderId, body: "mi código es 482913" })).rejects.toThrow(/código de confirmación/);
      await expect(c.chat.send({ orderId, body: "4 8 2 - 9 1 3" })).rejects.toThrow(/código de confirmación/);
      expect(await messagesOf(orderId)).toHaveLength(0);
      await c.chat.send({ orderId, body: "Casa 12, portón negro" }); // un mensaje normal sí pasa
      expect(await messagesOf(orderId)).toHaveLength(1);
    });

    it("rechaza mensajes vacíos o de más de 500 caracteres", async () => {
      const { customer, orderId } = await setupChat();
      const c = callerFor(customer);
      await expect(c.chat.send({ orderId, body: "   " })).rejects.toThrow();
      await expect(c.chat.send({ orderId, body: "x".repeat(501) })).rejects.toThrow();
      expect(await messagesOf(orderId)).toHaveLength(0);
    });

    it("frena el spam: el mensaje 11 en un minuto es rechazado", async () => {
      const { customer, orderId } = await setupChat();
      const c = callerFor(customer);
      for (let i = 0; i < 10; i++) await c.chat.send({ orderId, body: `mensaje ${i}` });
      await expect(c.chat.send({ orderId, body: "mensaje 11" })).rejects.toThrow(/muy rápido/);
      expect(await messagesOf(orderId)).toHaveLength(10);
    });

    it("markRead solo marca lo recibido, no lo que envié yo", async () => {
      const { customer, courier, orderId } = await setupChat();
      await callerFor(customer).chat.send({ orderId, body: "del cliente" });
      await callerFor(courier).chat.send({ orderId, body: "del repartidor" });
      await callerFor(customer).chat.markRead({ orderId });
      const rows = await messagesOf(orderId);
      expect(rows.find((m) => m.senderRole === "courier")!.readAt).not.toBeNull();
      expect(rows.find((m) => m.senderRole === "customer")!.readAt).toBeNull();
    });

    it("si el pedido pasa a otro repartidor, el nuevo no ve los mensajes del anterior", async () => {
      const { customer, courier: first, orderId } = await setupChat();
      await callerFor(first).chat.send({ orderId, body: "Ya recogí tu pedido" });

      // Simula soltar y volver a tomar: otro repartidor queda asignado.
      const second = await mkUser("courier");
      await db.update(S.orders).set({ courierId: second.id }).where(eq(S.orders.id, orderId));

      expect((await callerFor(second).chat.list({ orderId })).messages).toHaveLength(0);
      expect((await callerFor(customer).chat.list({ orderId })).messages).toHaveLength(0);
      await expect(callerFor(first).chat.list({ orderId })).rejects.toThrow(/No puedes acceder al chat/);
      await expect(callerFor(first).chat.send({ orderId, body: "sigo aquí" })).rejects.toThrow(/No puedes acceder al chat/);
    });

    it("no hay chat en pedidos de rescate", async () => {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, type: "rescue", status: "accepted" });
      await expect(callerFor(customer).chat.list({ orderId })).rejects.toThrow(/No puedes acceder al chat/);
    });
  });

  // ------------------------------------------------------------------ repartidor visible para el cliente
  describe("datos del repartidor para el cliente", () => {
    async function setupCourierOrder(status: "picked_up" | "delivered" | "ready" | "cancelled", withCourier = true) {
      const customer = await mkUser("customer");
      const biz = await mkBusiness((await mkUser("business")).id);
      const courier = await mkUser("courier");
      await db.update(S.users).set({
        name: "Carlos Andrés Pérez", email: "carlos@test.com", phone: "0991234567",
        courierVehicle: "Moto Honda 150", courierPlate: "gab-1234", courierPhotoUrl: "https://example.com/c.jpg",
      }).where(eq(S.users.id, courier.id));
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, status, courierId: withCourier ? courier.id : null });
      return { customer, courier, orderId };
    }

    it("mientras va en camino el cliente ve nombre, vehículo y placa, pero ningún dato de contacto", async () => {
      const { customer, orderId } = await setupCourierOrder("picked_up");
      const res = await callerFor(customer).orders.byId({ id: orderId });
      expect(res!.courier).toEqual({ name: "Carlos", photoUrl: "https://example.com/c.jpg", vehicle: "Moto Honda 150", plate: "GAB-1234", rating: null, ratingCount: 0 });
      const raw = JSON.stringify(res);
      expect(raw).not.toContain("carlos@test.com");
      expect(raw).not.toContain("0991234567");
      expect(raw).not.toContain("Pérez");
    });

    it("tras la entrega sigue visible", async () => {
      const { customer, orderId } = await setupCourierOrder("delivered");
      expect((await callerFor(customer).orders.byId({ id: orderId }))!.courier?.name).toBe("Carlos");
    });

    it("no hay repartidor que mostrar antes de que lo recoja ni si el pedido se canceló", async () => {
      const ready = await setupCourierOrder("ready", false);
      expect((await callerFor(ready.customer).orders.byId({ id: ready.orderId }))!.courier).toBeNull();
      const cancelled = await setupCourierOrder("cancelled");
      expect((await callerFor(cancelled.customer).orders.byId({ id: cancelled.orderId }))!.courier).toBeNull();
    });

    it("el propio repartidor no recibe su tarjeta y un extraño no puede ver el pedido", async () => {
      const { courier, orderId } = await setupCourierOrder("picked_up");
      expect((await callerFor(courier).orders.byId({ id: orderId }))!.courier).toBeNull();
      const stranger = await mkUser("customer");
      await expect(callerFor(stranger).orders.byId({ id: orderId })).rejects.toThrow(/No puedes ver este pedido/);
    });
  });

  // ------------------------------------------------------------------ estadísticas del comercio
  describe("estadísticas del comercio", () => {
    it("las ventas suman solo el subtotal de lo ENTREGADO (sin envío) y 'hoy' usa la hora de Ecuador", async () => {
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const customer = await mkUser("customer");
      const startToday = startOfDayEcuador();
      const base = { customerId: customer.id, businessId: biz, deliveryFee: 1 };
      await mkOrder({ ...base, status: "delivered", subtotal: 5, total: 6, deliveredAt: new Date() }); // hoy
      await mkOrder({ ...base, status: "delivered", subtotal: 7, total: 8, deliveredAt: new Date(startToday.getTime() - 3_600_000) }); // ayer
      await mkOrder({ ...base, status: "pending", subtotal: 100, total: 101 }); // aún no se entrega
      await mkOrder({ ...base, status: "cancelled", subtotal: 50, total: 51 });

      const stats = await callerFor(owner).business.stats();
      expect(stats.revenue).toBe(12); // 5 + 7, sin envío y sin pendientes ni cancelados
      expect(stats.todaySales).toBe(5);
      expect(stats.todayDelivered).toBe(1);
      expect(stats.deliveredOrders).toBe(2);
      expect(stats.totalOrders).toBe(4);
      expect(stats.activeOrders).toBe(1);
      expect(stats.todayOrders).toBe(3); // recibidos hoy sin contar el cancelado
    });

    it("un comercio sin pedidos muestra todo en cero", async () => {
      const owner = await mkUser("business");
      await mkBusiness(owner.id);
      const stats = await callerFor(owner).business.stats();
      expect([stats.revenue, stats.todaySales, stats.totalOrders, stats.activeOrders, stats.todayOrders]).toEqual([0, 0, 0, 0, 0]);
    });
  });

  // ------------------------------------------------------------------ cancelación por el comercio
  describe("cancelación por el comercio", () => {
    async function setupBiz(over: Partial<typeof S.orders.$inferInsert> = {}) {
      const customer = await mkUser("customer");
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, ...over });
      return { customer, owner, biz, orderId };
    }
    const cancel = (owner: Awaited<ReturnType<typeof mkUser>>, orderId: number, reason?: string) =>
      callerFor(owner).business.updateOrderStatus({ orderId, status: "cancelled", reason });

    it("puede cancelar un delivery que ya está en cocina, indicando el motivo", async () => {
      const { owner, orderId } = await setupBiz({ status: "preparing" });
      await cancel(owner, orderId, "Se acabó el pollo");
      const order = await getOrder(orderId);
      expect(order.status).toBe("cancelled");
      expect(order.cancelledBy).toBe("business");
      expect(order.cancelReason).toBe("Se acabó el pollo");
    });

    it("puede cancelar un delivery listo que aún no tiene repartidor", async () => {
      const { owner, orderId } = await setupBiz({ status: "ready", readyAt: new Date() });
      await cancel(owner, orderId, "Cerramos por un imprevisto");
      expect((await getOrder(orderId)).status).toBe("cancelled");
    });

    it("en cocina o listo exige un motivo", async () => {
      for (const status of ["preparing", "ready"] as const) {
        const { owner, orderId } = await setupBiz({ status, readyAt: new Date() });
        await expect(cancel(owner, orderId)).rejects.toThrow(/Indica el motivo/);
        await expect(cancel(owner, orderId, "   ")).rejects.toThrow(/Indica el motivo/);
        expect((await getOrder(orderId)).status).toBe(status);
      }
    });

    it("antes de cocina el motivo sigue siendo opcional", async () => {
      const { owner, orderId } = await setupBiz({ status: "pending" });
      await cancel(owner, orderId);
      expect((await getOrder(orderId)).status).toBe("cancelled");
    });

    it("no puede cancelar cuando el repartidor ya lo recogió", async () => {
      const courier = await mkUser("courier");
      const { owner, orderId } = await setupBiz({ status: "picked_up", courierId: courier.id });
      await expect(cancel(owner, orderId, "Ya no puedo")).rejects.toThrow(/No puedes pasar/);
      expect((await getOrder(orderId)).status).toBe("picked_up");
    });

    it("un rescate en preparación no se puede cancelar desde el local", async () => {
      const { owner, orderId } = await setupBiz({ type: "rescue", status: "preparing" });
      await expect(cancel(owner, orderId, "Ya no quiero")).rejects.toThrow(/ya no se puede cancelar desde el local/);
      expect((await getOrder(orderId)).status).toBe("preparing");
    });

    it("si el repartidor lo toma justo cuando el local cancela, gana uno solo y el estado queda coherente", async () => {
      const { owner, orderId } = await setupBiz({ status: "ready", readyAt: new Date() });
      const courier = await mkUser("courier");
      const results = await Promise.allSettled([
        callerFor(courier).courier.accept({ orderId }),
        cancel(owner, orderId, "Sin ingredientes"),
      ]);
      expect(fulfilled(results)).toBe(1);
      const order = await getOrder(orderId);
      if (order.status === "cancelled") expect(order.courierId).toBeNull();
      else { expect(order.status).toBe("picked_up"); expect(order.courierId).toBe(courier.id); }
    });

    it("otro comercio no puede cancelar pedidos ajenos", async () => {
      const { orderId } = await setupBiz({ status: "preparing" });
      const other = await mkUser("business");
      await mkBusiness(other.id);
      await expect(cancel(other, orderId, "Intento ajeno")).rejects.toThrow();
      expect((await getOrder(orderId)).status).toBe("preparing");
    });
  });

  // ------------------------------------------------------------------ pedidos que el local no hace avanzar
  describe("pedidos que el local no hace avanzar (sweepOrders)", () => {
    async function setupStall(over: Partial<typeof S.orders.$inferInsert>) {
      const customer = await mkUser("customer");
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, ...over });
      return { owner, orderId };
    }

    it("a los 25 min recuerda al local UNA vez, sin cancelar y sin reiniciar el reloj de cancelación", async () => {
      const { orderId } = await setupStall({ status: "preparing", updatedAt: minutesAgo(30) });
      await sweepOrders();
      const first = await getOrder(orderId);
      expect(first.status).toBe("preparing");
      expect(first.businessReminderSentAt).not.toBeNull();
      // updatedAt sigue marcando el último cambio de estado (tolerancia por redondeo a segundos)
      expect(Math.abs(first.updatedAt.getTime() - minutesAgo(30).getTime())).toBeLessThan(5_000);
      const sentAt = first.businessReminderSentAt!.getTime();
      await sweepOrders();
      expect((await getOrder(orderId)).businessReminderSentAt!.getTime()).toBe(sentAt);
    });

    it("cancela un delivery en cocina que no avanza en 60 min", async () => {
      const { orderId } = await setupStall({ status: "preparing", updatedAt: minutesAgo(65) });
      await sweepOrders();
      const order = await getOrder(orderId);
      expect(order.status).toBe("cancelled");
      expect(order.cancelledBy).toBe("system");
      expect(order.cancelReason).toMatch(/no avanzó/);
    });

    it("también cancela uno aceptado que nunca pasó a cocina", async () => {
      const { orderId } = await setupStall({ status: "accepted", updatedAt: minutesAgo(70) });
      await sweepOrders();
      expect((await getOrder(orderId)).status).toBe("cancelled");
    });

    it("no toca un rescate aceptado aunque lleve horas esperando al cliente", async () => {
      const { orderId } = await setupStall({ type: "rescue", status: "accepted", updatedAt: minutesAgo(180) });
      await sweepOrders();
      const order = await getOrder(orderId);
      expect(order.status).toBe("accepted");
      expect(order.businessReminderSentAt).toBeNull();
    });

    it("no toca pedidos que avanzaron hace poco", async () => {
      const { orderId } = await setupStall({ status: "preparing", updatedAt: minutesAgo(10) });
      await sweepOrders();
      const order = await getOrder(orderId);
      expect(order.status).toBe("preparing");
      expect(order.businessReminderSentAt).toBeNull();
    });

    it("al cambiar de estado se reinicia el recordatorio", async () => {
      const { owner, orderId } = await setupStall({ status: "accepted", updatedAt: minutesAgo(30), businessReminderSentAt: new Date() });
      await callerFor(owner).business.updateOrderStatus({ orderId, status: "preparing" });
      const order = await getOrder(orderId);
      expect(order.status).toBe("preparing");
      expect(order.businessReminderSentAt).toBeNull();
    });
  });

  // ------------------------------------------------------------------ calificaciones
  describe("calificaciones", () => {
    /** Pedido entregado con cliente, comercio y repartidor. */
    async function setupRating(over: Partial<typeof S.orders.$inferInsert> = {}) {
      const customer = await mkUser("customer");
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const courier = await mkUser("courier");
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, status: "delivered", courierId: courier.id, deliveredAt: new Date(), ...over });
      return { customer, owner, biz, courier, orderId };
    }
    const ratingsOf = (orderId: number) => db.select().from(S.ratings).where(eq(S.ratings.orderId, orderId));
    const bizRow = async (id: number) => (await db.select().from(S.businesses).where(eq(S.businesses.id, id)))[0];
    const userRow = async (id: number) => (await db.select().from(S.users).where(eq(S.users.id, id)))[0];

    it("solo el cliente del pedido puede calificar (no un tercero, ni el comercio, ni el repartidor)", async () => {
      const { owner, courier, orderId } = await setupRating();
      const stranger = await mkUser("customer");
      for (const who of [stranger, owner, courier]) {
        await expect(callerFor(who).orders.rate({ orderId, businessStars: 5 })).rejects.toThrow(/No puedes calificar este pedido/);
      }
      expect(await ratingsOf(orderId)).toHaveLength(0);
    });

    it("solo se califica un pedido entregado", async () => {
      for (const status of ["pending", "accepted", "preparing", "ready", "picked_up", "cancelled"] as const) {
        const { customer, orderId } = await setupRating({ status });
        await expect(callerFor(customer).orders.rate({ orderId, businessStars: 5 })).rejects.toThrow(/cuando el pedido sea entregado/);
        expect(await ratingsOf(orderId)).toHaveLength(0);
      }
    });

    it("califica al comercio y al repartidor y actualiza ambos promedios", async () => {
      const { customer, biz, courier, orderId } = await setupRating();
      await callerFor(customer).orders.rate({ orderId, businessStars: 5, businessComment: "  Muy rico  ", courierStars: 4, courierComment: "Rápido" });
      const [row] = await ratingsOf(orderId);
      expect(row.businessComment).toBe("Muy rico"); // se recorta
      expect(row.courierId).toBe(courier.id);
      const b = await bizRow(biz);
      expect(b.ratingCount).toBe(1);
      expect(b.rating).toBe(bayesianRating(5, 1));
      const c = await userRow(courier.id);
      expect(c.courierRatingCount).toBe(1);
      expect(c.courierRating).toBe(bayesianRating(4, 1));
    });

    it("si no califica al repartidor, no cuenta para su promedio", async () => {
      const { customer, courier, orderId } = await setupRating();
      await callerFor(customer).orders.rate({ orderId, businessStars: 4, courierComment: "ignorado" });
      const [row] = await ratingsOf(orderId);
      expect(row.courierId).toBeNull();
      expect(row.courierStars).toBeNull();
      expect(row.courierComment).toBeNull();
      const c = await userRow(courier.id);
      expect(c.courierRatingCount).toBe(0);
      expect(c.courierRating).toBeNull();
    });

    it("no se califica al repartidor en un pedido que no tuvo (rescate), pero sí al comercio", async () => {
      const { customer, orderId } = await setupRating({ type: "rescue", courierId: null });
      await expect(callerFor(customer).orders.rate({ orderId, businessStars: 5, courierStars: 5 })).rejects.toThrow(/no tuvo repartidor/);
      expect(await ratingsOf(orderId)).toHaveLength(0);
      await callerFor(customer).orders.rate({ orderId, businessStars: 5 });
      expect(await ratingsOf(orderId)).toHaveLength(1);
    });

    it("calificar dos veces: la segunda se rechaza y no cambia nada", async () => {
      const { customer, biz, orderId } = await setupRating();
      const c = callerFor(customer);
      await c.orders.rate({ orderId, businessStars: 5 });
      await expect(c.orders.rate({ orderId, businessStars: 1 })).rejects.toThrow(/Ya calificaste este pedido/);
      const rows = await ratingsOf(orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0].businessStars).toBe(5);
      const b = await bizRow(biz);
      expect([b.ratingCount, b.rating]).toEqual([1, bayesianRating(5, 1)]);
    });

    it("dos envíos simultáneos cuentan una sola calificación", async () => {
      const { customer, biz, orderId } = await setupRating();
      const c = callerFor(customer);
      const results = await Promise.allSettled([
        c.orders.rate({ orderId, businessStars: 5 }),
        c.orders.rate({ orderId, businessStars: 5 }),
      ]);
      expect(fulfilled(results)).toBe(1);
      expect(await ratingsOf(orderId)).toHaveLength(1);
      expect((await bizRow(biz)).ratingCount).toBe(1);
    });

    it("rechaza estrellas fuera de 1–5 y comentarios de más de 300 caracteres", async () => {
      const { customer, orderId } = await setupRating();
      const c = callerFor(customer);
      for (const businessStars of [0, 6, 3.5]) await expect(c.orders.rate({ orderId, businessStars })).rejects.toThrow();
      await expect(c.orders.rate({ orderId, businessStars: 5, businessComment: "x".repeat(301) })).rejects.toThrow();
      expect(await ratingsOf(orderId)).toHaveLength(0);
    });

    it("el promedio del comercio se recalcula con varias calificaciones", async () => {
      const { customer, biz, orderId } = await setupRating();
      const second = await mkUser("customer");
      const orderId2 = await mkOrder({ customerId: second.id, businessId: biz, status: "delivered", deliveredAt: new Date() });
      await callerFor(customer).orders.rate({ orderId, businessStars: 5 });
      await callerFor(second).orders.rate({ orderId: orderId2, businessStars: 1 });
      const b = await bizRow(biz);
      expect(b.ratingCount).toBe(2);
      expect(b.rating).toBe(bayesianRating(6, 2));
    });

    it("myRating devuelve solo la calificación propia", async () => {
      const { customer, owner, orderId } = await setupRating();
      await callerFor(customer).orders.rate({ orderId, businessStars: 4 });
      expect((await callerFor(customer).orders.myRating({ orderId }))?.businessStars).toBe(4);
      expect(await callerFor(owner).orders.myRating({ orderId })).toBeNull();
      expect(await callerFor(await mkUser("customer")).orders.myRating({ orderId })).toBeNull();
    });
  });

  // ------------------------------------------------------------------ reseñas del comercio
  describe("reseñas del comercio (business.reviews)", () => {
    it("el dueño ve solo las reseñas de su local, de la más nueva a la más antigua y solo con el primer nombre", async () => {
      const ownerA = await mkUser("business");
      const bizA = await mkBusiness(ownerA.id);
      const ownerB = await mkUser("business");
      const bizB = await mkBusiness(ownerB.id);
      const customer = await mkUser("customer");
      await db.update(S.users).set({ name: "María Fernanda López" }).where(eq(S.users.id, customer.id));
      const [fresh] = await db.select().from(S.users).where(eq(S.users.id, customer.id));
      const c = callerFor(fresh);
      const delivered = (businessId: number) => mkOrder({ customerId: customer.id, businessId, status: "delivered", deliveredAt: new Date() });
      const o1 = await delivered(bizA);
      const o2 = await delivered(bizA);
      const o3 = await delivered(bizB);
      await c.orders.rate({ orderId: o1, businessStars: 5, businessComment: "Excelente" });
      await c.orders.rate({ orderId: o2, businessStars: 3 });
      await c.orders.rate({ orderId: o3, businessStars: 1, businessComment: "Del otro local" });

      const a = await callerFor(ownerA).business.reviews();
      expect(a.map((r) => r.businessStars)).toEqual([3, 5]); // la más nueva primero
      expect(a[1].businessComment).toBe("Excelente");
      expect(a[0].businessComment).toBeNull();
      expect(a.every((r) => r.customerName === "María")).toBe(true);
      expect(JSON.stringify(a)).not.toContain("López");
      expect(JSON.stringify(a)).not.toContain("Del otro local");

      const b = await callerFor(ownerB).business.reviews();
      expect(b).toHaveLength(1);
      expect(b[0].businessStars).toBe(1);
    });

    it("quien no tiene un comercio no puede consultar reseñas", async () => {
      await expect(callerFor(await mkUser("customer")).business.reviews()).rejects.toThrow(/Primero registra tu negocio/);
    });

    it("un comercio sin calificaciones devuelve una lista vacía", async () => {
      const owner = await mkUser("business");
      await mkBusiness(owner.id);
      expect(await callerFor(owner).business.reviews()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ reclamos por rol
  describe("reclamos por rol", () => {
    const REASON = "El pedido llegó incompleto y frío";
    async function setupClaim(over: Partial<typeof S.orders.$inferInsert> = {}) {
      const customer = await mkUser("customer");
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const courier = await mkUser("courier");
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, status: "delivered", courierId: courier.id, deliveredAt: new Date(), ...over });
      return { customer, owner, biz, courier, orderId };
    }
    const claimsOf = (orderId: number) => db.select().from(S.claims).where(eq(S.claims.orderId, orderId));
    const eventsOf = (orderId: number) => db.select().from(S.orderEvents).where(eq(S.orderEvents.orderId, orderId));

    it("cada participante reclama con su propio rol: cliente, comercio y repartidor", async () => {
      const { customer, owner, courier, orderId } = await setupClaim();
      await callerFor(customer).orders.createClaim({ orderId, reason: REASON });
      await callerFor(owner).orders.createClaim({ orderId, reason: REASON });
      await callerFor(courier).orders.createClaim({ orderId, reason: REASON });
      const rows = await claimsOf(orderId);
      expect(rows.map((r) => r.reporterRole).sort()).toEqual(["business", "courier", "customer"]);
      expect(rows.find((r) => r.reporterRole === "customer")!.userId).toBe(customer.id);
      expect(rows.find((r) => r.reporterRole === "business")!.userId).toBe(owner.id);
      expect(rows.find((r) => r.reporterRole === "courier")!.userId).toBe(courier.id);
      expect(rows.every((r) => r.status === "open")).toBe(true);
    });

    it("un tercero, otro comercio o el repartidor que ya no lo lleva no pueden reclamar", async () => {
      const { orderId } = await setupClaim();
      const stranger = await mkUser("customer");
      const otherOwner = await mkUser("business");
      await mkBusiness(otherOwner.id);
      const otherCourier = await mkUser("courier");
      for (const who of [stranger, otherOwner, otherCourier]) {
        await expect(callerFor(who).orders.createClaim({ orderId, reason: REASON })).rejects.toThrow(/No puedes reclamar este pedido/);
      }
      // y el repartidor que soltó el pedido (ya no está asignado)
      const released = await setupClaim({ courierId: null });
      await expect(callerFor(released.courier).orders.createClaim({ orderId: released.orderId, reason: REASON })).rejects.toThrow(/No puedes reclamar este pedido/);
      expect(await claimsOf(orderId)).toHaveLength(0);
      expect(await claimsOf(released.orderId)).toHaveLength(0);
    });

    it("comercio y repartidor no reclaman un pedido aún pendiente; el cliente sí", async () => {
      const { customer, owner, orderId } = await setupClaim({ status: "pending", courierId: null });
      await expect(callerFor(owner).orders.createClaim({ orderId, reason: REASON })).rejects.toThrow(/aún no fue aceptado/);
      const withCourier = await setupClaim({ status: "pending" });
      await expect(callerFor(withCourier.courier).orders.createClaim({ orderId: withCourier.orderId, reason: REASON })).rejects.toThrow(/aún no fue aceptado/);
      await callerFor(customer).orders.createClaim({ orderId, reason: REASON });
      expect(await claimsOf(orderId)).toHaveLength(1);
    });

    it("exige un motivo de al menos 10 caracteres y no más de 500", async () => {
      const { customer, orderId } = await setupClaim();
      await expect(callerFor(customer).orders.createClaim({ orderId, reason: "corto" })).rejects.toThrow(/mínimo 10/);
      await expect(callerFor(customer).orders.createClaim({ orderId, reason: "x".repeat(501) })).rejects.toThrow();
      expect(await claimsOf(orderId)).toHaveLength(0);
    });

    it("no permite dos reclamos abiertos del mismo rol en el mismo pedido, pero sí de otro rol", async () => {
      const { customer, owner, orderId } = await setupClaim();
      await callerFor(customer).orders.createClaim({ orderId, reason: REASON });
      await expect(callerFor(customer).orders.createClaim({ orderId, reason: "Otro motivo distinto aquí" })).rejects.toThrow(/Ya tienes un reclamo abierto/);
      await callerFor(owner).orders.createClaim({ orderId, reason: REASON });
      expect(await claimsOf(orderId)).toHaveLength(2);
    });

    it("quien tiene dos roles usa el primero salvo que elija otro, y no puede elegir uno que no tiene", async () => {
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const orderId = await mkOrder({ customerId: owner.id, businessId: biz, status: "delivered", deliveredAt: new Date() }); // el dueño también es el cliente
      const c = callerFor(owner);
      await c.orders.createClaim({ orderId, reason: REASON }); // sin role → customer
      await c.orders.createClaim({ orderId, reason: REASON, role: "business" });
      await expect(c.orders.createClaim({ orderId, reason: REASON, role: "courier" })).rejects.toThrow(/No puedes reclamar este pedido/);
      expect((await claimsOf(orderId)).map((r) => r.reporterRole).sort()).toEqual(["business", "customer"]);
    });

    it("el reclamo queda en el historial del pedido", async () => {
      const { courier, orderId } = await setupClaim();
      await callerFor(courier).orders.createClaim({ orderId, reason: REASON });
      const ev = (await eventsOf(orderId)).find((e) => e.type === "claim_opened");
      expect(ev?.actorRole).toBe("courier");
      expect(ev?.actorId).toBe(courier.id);
    });

    it("myClaims muestra a cada persona solo sus propios reclamos", async () => {
      const { customer, owner, orderId } = await setupClaim();
      await callerFor(customer).orders.createClaim({ orderId, reason: REASON });
      await callerFor(owner).orders.createClaim({ orderId, reason: "El cliente no estaba en casa" });
      const mine = await callerFor(customer).orders.myClaims({ orderId });
      expect(mine).toHaveLength(1);
      expect(mine[0].reporterRole).toBe("customer");
      expect(await callerFor(await mkUser("customer")).orders.myClaims({ orderId })).toEqual([]);
    });

    describe("atención del administrador", () => {
      async function openClaim() {
        const ctx = await setupClaim();
        await callerFor(ctx.customer).orders.createClaim({ orderId: ctx.orderId, reason: REASON });
        const [claim] = await claimsOf(ctx.orderId);
        return { ...ctx, claim };
      }

      it("solo un admin puede ver y resolver reclamos", async () => {
        const { customer, owner, courier, claim } = await openClaim();
        for (const who of [customer, owner, courier]) {
          await expect(callerFor(who).admin.claims()).rejects.toThrow();
          await expect(callerFor(who).admin.resolveClaim({ id: claim.id, decision: "resolved", resolution: "Intento sin permiso" })).rejects.toThrow();
        }
        expect((await claimsOf(claim.orderId))[0].status).toBe("open");
      });

      it("el admin lista los reclamos y los filtra por estado", async () => {
        const { orderId, claim } = await openClaim();
        const admin = await mkAdmin();
        const open = await callerFor(admin).admin.claims({ status: "open" });
        expect(open.some((c) => c.id === claim.id && c.orderId === orderId && c.reporterRole === "customer")).toBe(true);
        const resolved = await callerFor(admin).admin.claims({ status: "resolved" });
        expect(resolved.some((c) => c.id === claim.id)).toBe(false);
      });

      it("resolver deja constancia, avisa en el historial y no se puede resolver dos veces", async () => {
        const { customer, orderId, claim } = await openClaim();
        const admin = await mkAdmin();
        await callerFor(admin).admin.resolveClaim({ id: claim.id, decision: "resolved", resolution: "Te reembolsamos el pedido" });
        const [row] = await claimsOf(orderId);
        expect(row.status).toBe("resolved");
        expect(row.resolution).toBe("Te reembolsamos el pedido");
        expect(row.resolvedBy).toBe(admin.id);
        expect(row.resolvedAt).not.toBeNull();
        expect((await eventsOf(orderId)).some((e) => e.type === "claim_resolved" && e.actorRole === "admin")).toBe(true);
        expect((await callerFor(customer).orders.myClaims({ orderId }))[0].status).toBe("resolved");
        await expect(callerFor(admin).admin.resolveClaim({ id: claim.id, decision: "rejected", resolution: "Segundo intento" })).rejects.toThrow(/ya fue atendido/);
        expect((await claimsOf(orderId))[0].status).toBe("resolved");
      });

      it("dos admins resolviendo a la vez: gana uno solo", async () => {
        const { claim } = await openClaim();
        const [a1, a2] = [await mkAdmin(), await mkAdmin()];
        const results = await Promise.allSettled([
          callerFor(a1).admin.resolveClaim({ id: claim.id, decision: "resolved", resolution: "Respuesta del admin 1" }),
          callerFor(a2).admin.resolveClaim({ id: claim.id, decision: "rejected", resolution: "Respuesta del admin 2" }),
        ]);
        expect(fulfilled(results)).toBe(1);
      });

      it("rechazar exige una respuesta y queda registrado como rechazo", async () => {
        const { orderId, claim } = await openClaim();
        const admin = await mkAdmin();
        await expect(callerFor(admin).admin.resolveClaim({ id: claim.id, decision: "rejected", resolution: "no" })).rejects.toThrow(/Escribe una respuesta/);
        expect((await claimsOf(orderId))[0].status).toBe("open");
        await callerFor(admin).admin.resolveClaim({ id: claim.id, decision: "rejected", resolution: "El pedido sí fue entregado completo" });
        expect((await claimsOf(orderId))[0].status).toBe("rejected");
        expect((await eventsOf(orderId)).some((e) => e.type === "claim_rejected")).toBe(true);
      });

      it("tras resolverse se puede abrir un reclamo nuevo del mismo rol", async () => {
        const { customer, orderId, claim } = await openClaim();
        await callerFor(await mkAdmin()).admin.resolveClaim({ id: claim.id, decision: "resolved", resolution: "Caso cerrado, gracias" });
        await callerFor(customer).orders.createClaim({ orderId, reason: "Sigue el mismo problema con el pedido" });
        expect(await claimsOf(orderId)).toHaveLength(2);
      });

      it("un reclamo inexistente responde 'no encontrado'", async () => {
        await expect(callerFor(await mkAdmin()).admin.resolveClaim({ id: 999_999_999, decision: "resolved", resolution: "No existe este reclamo" })).rejects.toThrow(/Reclamo no encontrado/);
      });
    });
  });

  // ------------------------------------------------------------------ direcciones guardadas
  describe("direcciones guardadas", () => {
    const addr = (over: Partial<{ label: string; address: string; lat: number; lng: number; isDefault: boolean }> = {}) => ({
      label: "Casa", address: "Calle Bolívar 123 y Sucre", lat: -2.134, lng: -79.594, isDefault: false, ...over,
    });
    const countOf = async (userId: number) => (await db.select().from(S.customerAddresses).where(eq(S.customerAddresses.userId, userId)));

    it("guarda y lista solo las propias; la primera queda como principal", async () => {
      const me = await mkUser("customer");
      const other = await mkUser("customer");
      await callerFor(me).profile.saveAddress(addr({ label: "Casa" }));
      await callerFor(me).profile.saveAddress(addr({ label: "Trabajo", address: "Av. 17 de Septiembre 45" }));
      const mine = await callerFor(me).profile.myAddresses();
      expect(mine).toHaveLength(2);
      expect(mine.filter((a) => a.isDefault).map((a) => a.label)).toEqual(["Casa"]);
      expect(await callerFor(other).profile.myAddresses()).toEqual([]);
    });

    it("la principal sale primero y nunca hay más de una", async () => {
      const me = await mkUser("customer");
      const c = callerFor(me);
      await c.profile.saveAddress(addr({ label: "A" }));
      await c.profile.saveAddress(addr({ label: "B" }));
      await c.profile.saveAddress(addr({ label: "C", isDefault: true }));
      const list = await c.profile.myAddresses();
      expect(list[0].label).toBe("C");
      expect(list.filter((a) => a.isDefault)).toHaveLength(1);
    });

    it("el límite es de 10 direcciones por cliente", async () => {
      const me = await mkUser("customer");
      const c = callerFor(me);
      for (let i = 0; i < 10; i++) await c.profile.saveAddress(addr({ label: `Dir ${i}` }));
      await expect(c.profile.saveAddress(addr({ label: "Dir 11" }))).rejects.toThrow(/hasta 10/);
      expect(await countOf(me.id)).toHaveLength(10);
      // el límite es por persona: otro cliente puede guardar las suyas
      await callerFor(await mkUser("customer")).profile.saveAddress(addr());
    });

    it("guardados simultáneos no superan el límite ni dejan dos principales", async () => {
      const me = await mkUser("customer");
      const c = callerFor(me);
      for (let i = 0; i < 8; i++) await c.profile.saveAddress(addr({ label: `Dir ${i}` }));
      const results = await Promise.allSettled([1, 2, 3, 4].map((i) => c.profile.saveAddress(addr({ label: `Nueva ${i}`, isDefault: true }))));
      expect(fulfilled(results)).toBe(2); // solo caben 2 más
      const rows = await countOf(me.id);
      expect(rows).toHaveLength(10);
      expect(rows.filter((a) => a.isDefault)).toHaveLength(1);
    });

    it("nadie puede borrar la dirección de otra persona", async () => {
      const me = await mkUser("customer");
      const intruder = await mkUser("customer");
      await callerFor(me).profile.saveAddress(addr());
      const [saved] = await callerFor(me).profile.myAddresses();
      await callerFor(intruder).profile.deleteAddress({ id: saved.id });
      expect(await countOf(me.id)).toHaveLength(1);
      await callerFor(me).profile.deleteAddress({ id: saved.id });
      expect(await countOf(me.id)).toHaveLength(0);
    });

    it("al borrar la principal, la más reciente de las que quedan pasa a ser principal", async () => {
      const me = await mkUser("customer");
      const c = callerFor(me);
      await c.profile.saveAddress(addr({ label: "Casa" })); // principal
      await c.profile.saveAddress(addr({ label: "Trabajo" }));
      await c.profile.saveAddress(addr({ label: "Gimnasio" }));
      const principal = (await c.profile.myAddresses()).find((a) => a.isDefault)!;
      await c.profile.deleteAddress({ id: principal.id });
      const list = await c.profile.myAddresses();
      expect(list).toHaveLength(2);
      expect(list[0].label).toBe("Gimnasio");
      expect(list.filter((a) => a.isDefault).map((a) => a.label)).toEqual(["Gimnasio"]);
    });

    it("rechaza etiquetas vacías, direcciones cortas y coordenadas imposibles", async () => {
      const me = await mkUser("customer");
      const c = callerFor(me);
      for (const bad of [{ label: "  " }, { address: "abc" }, { lat: 91 }, { lat: -91 }, { lng: 181 }, { lng: -181 }]) {
        await expect(c.profile.saveAddress(addr(bad))).rejects.toThrow();
      }
      expect(await countOf(me.id)).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------ catálogo
  describe("catálogo: locales abiertos primero", () => {
    it("un local abierto va antes que uno cerrado aunque este tenga más estrellas; dentro de cada grupo, por calificación", async () => {
      const mk = async (name: string, over: Partial<typeof S.businesses.$inferInsert>) => {
        const owner = await mkUser("business");
        return mkBusiness(owner.id, { name: `${tag}-cat ${name}`, opensAt: "00:00", closesAt: "00:00", ...over }); // 00:00–00:00 = 24 h
      };
      await mk("cerrado-49", { isOpen: false, rating: 4.9 });
      await mk("abierto-30", { isOpen: true, rating: 3.0 });
      await mk("abierto-40", { isOpen: true, rating: 4.0 });
      await mk("cerrado-20", { isOpen: false, rating: 2.0 });
      const list = await callerFor(await mkUser("customer")).catalog.businesses({ query: `${tag}-cat` });
      expect(list.map((b) => b.name.replace(`${tag}-cat `, ""))).toEqual(["abierto-40", "abierto-30", "cerrado-49", "cerrado-20"]);
      expect(list.map((b) => b.openNow)).toEqual([true, true, false, false]);
    });

    it("no muestra locales sin aprobar", async () => {
      const owner = await mkUser("business");
      await mkBusiness(owner.id, { name: `${tag}-pend local`, approvalStatus: "pending", opensAt: "00:00", closesAt: "00:00" });
      expect(await callerFor(await mkUser("customer")).catalog.businesses({ query: `${tag}-pend` })).toEqual([]);
    });
  });
});
