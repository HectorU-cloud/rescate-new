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
import { startOfDayEcuador } from "./lib/business-rules";

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
});
