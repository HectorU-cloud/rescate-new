/**
 * Pruebas de integración (MySQL real) de las reglas de seguridad y de ubicación:
 * zona horaria UTC, ubicación real del comercio, privacidad del cliente en el tablero del
 * repartidor, y límite de intentos de los códigos de entrega y de retiro.
 *
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("seguridad y ubicación (MySQL real)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let appRouter: (typeof import("./router"))["appRouter"];

  const tag = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let seq = 0;
  const created = { users: [] as number[], businesses: [] as number[], orders: [] as number[], products: [] as number[] };

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
      await db.delete(S.courierLocations).where(inArray(S.courierLocations.orderId, created.orders));
      await db.delete(S.orders).where(inArray(S.orders.id, created.orders));
    }
    if (created.products.length) await db.delete(S.products).where(inArray(S.products.id, created.products));
    if (created.businesses.length) await db.delete(S.businesses).where(inArray(S.businesses.id, created.businesses));
    if (created.users.length) await db.delete(S.users).where(inArray(S.users.id, created.users));
  });

  // ------------------------------------------------------------------ ayudantes
  type User = Awaited<ReturnType<typeof mkUser>>;
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
    const u = await mkUser("customer");
    await db.update(S.users).set({ role: "admin" }).where(eq(S.users.id, u.id));
    return (await db.select().from(S.users).where(eq(S.users.id, u.id)))[0];
  }
  async function mkBusiness(ownerId: number, over: Partial<typeof S.businesses.$inferInsert> = {}) {
    const [{ id }] = await db
      .insert(S.businesses)
      .values({
        ownerId, name: `${tag} local ${seq++}`, category: "test", address: "Calle 1", lat: -2.134, lng: -79.594,
        approvalStatus: "approved", locationConfirmed: true, isOpen: true, opensAt: "00:00", closesAt: "00:00", ...over,
      })
      .$returningId();
    created.businesses.push(id);
    return id;
  }
  async function mkProduct(businessId: number) {
    const [{ id }] = await db.insert(S.products).values({ businessId, name: `${tag} prod`, price: 3 }).$returningId();
    created.products.push(id);
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
  const callerFor = (user: User) =>
    appRouter.createCaller({ req: new Request("http://localhost/test"), resHeaders: new Headers(), user });
  async function failure(p: Promise<unknown>) {
    try { await p; } catch (e) { return e as { code: string; message: string }; }
    throw new Error("se esperaba un error y la operación tuvo éxito");
  }
  const NEW_BIZ = (lat?: number, lng?: number) => ({
    name: `${tag} nuevo`, category: "comida-rapida", address: "Av. Principal 123", deliveryFee: 1, deliveryMinutes: 25,
    ...(lat !== undefined ? { lat, lng } : {}),
  });

  // ------------------------------------------------------------------ zona horaria
  describe("zona horaria", () => {
    it("la sesión de MySQL queda en UTC (Drizzle asume UTC al leer las fechas)", async () => {
      const res = (await db.execute(sql`SELECT @@session.time_zone AS tz`)) as unknown as Array<Array<{ tz: string }> | { tz: string }>;
      const rows = (Array.isArray(res[0]) ? res[0] : res) as Array<{ tz: string }>;
      expect(rows[0].tz).toBe("+00:00");
    });
    it("una fecha que pone la propia base (createdAt) coincide con la hora real", async () => {
      const owner = await mkUser("business");
      const customer = await mkUser("customer");
      const id = await mkOrder({ customerId: customer.id, businessId: await mkBusiness(owner.id) });
      const skewMin = Math.abs(Date.now() - new Date((await getOrder(id)).createdAt).getTime()) / 60_000;
      expect(skewMin).toBeLessThan(2); // sin el arreglo, con MySQL en otra zona daba 300 min
    });
  });

  // ------------------------------------------------------------------ ubicación del comercio
  describe("ubicación real del comercio", () => {
    it("registrar un local sin marcar el mapa es rechazado", async () => {
      const e = await failure(callerFor(await mkUser("business")).business.upsertBusiness(NEW_BIZ()));
      expect(e.code).toBe("BAD_REQUEST");
      expect(e.message).toMatch(/ubicación/i);
    });
    it("latitud sin longitud es rechazada", async () => {
      const e = await failure(callerFor(await mkUser("business")).business.upsertBusiness({ ...NEW_BIZ(), lat: -2.13 }));
      expect(e.code).toBe("BAD_REQUEST");
    });
    it("una ubicación fuera de la zona de servicio es rechazada", async () => {
      const e = await failure(callerFor(await mkUser("business")).business.upsertBusiness(NEW_BIZ(0, 0)));
      expect(e.code).toBe("BAD_REQUEST");
      expect(e.message).toMatch(/zona de servicio/i);
    });
    it("guarda la ubicación EXACTA (ya no es aleatoria), confirmada y pendiente de revisión", async () => {
      const a = await mkUser("business"), b = await mkUser("business");
      const { id: idA } = await callerFor(a).business.upsertBusiness(NEW_BIZ(-2.1412, -79.5987));
      const { id: idB } = await callerFor(b).business.upsertBusiness(NEW_BIZ(-2.1412, -79.5987));
      created.businesses.push(idA, idB);
      const [rowA] = await db.select().from(S.businesses).where(eq(S.businesses.id, idA));
      const [rowB] = await db.select().from(S.businesses).where(eq(S.businesses.id, idB));
      expect([rowA.lat, rowA.lng]).toEqual([-2.1412, -79.5987]);
      expect([rowB.lat, rowB.lng]).toEqual([rowA.lat, rowA.lng]); // antes cada uno salía distinto
      expect(rowA.locationConfirmed).toBe(true);
      expect(rowA.approvalStatus).toBe("pending");
    });
    it("editar los datos sin enviar coordenadas NO mueve el pin", async () => {
      const owner = await mkUser("business");
      const { id } = await callerFor(owner).business.upsertBusiness(NEW_BIZ(-2.14, -79.59));
      created.businesses.push(id);
      await callerFor(owner).business.upsertBusiness({ ...NEW_BIZ(), address: "Otra dirección 999" });
      const [row] = await db.select().from(S.businesses).where(eq(S.businesses.id, id));
      expect([row.lat, row.lng, row.address]).toEqual([-2.14, -79.59, "Otra dirección 999"]);
    });

    describe("setLocation", () => {
      it("mover el pin pocos metros mantiene el local aprobado", async () => {
        const owner = await mkUser("business");
        const id = await mkBusiness(owner.id, { lat: -2.14, lng: -79.59 });
        const r = await callerFor(owner).business.setLocation({ lat: -2.1401, lng: -79.5901 }); // ~15 m
        expect(r.needsReview).toBe(false);
        expect((await db.select().from(S.businesses).where(eq(S.businesses.id, id)))[0].approvalStatus).toBe("approved");
      });
      it("mover un local ya confirmado más de 300 m lo devuelve a revisión y lo cierra", async () => {
        const owner = await mkUser("business");
        const id = await mkBusiness(owner.id, { lat: -2.14, lng: -79.59 });
        const r = await callerFor(owner).business.setLocation({ lat: -2.15, lng: -79.59 }); // ~1.1 km
        expect(r.needsReview).toBe(true);
        const [row] = await db.select().from(S.businesses).where(eq(S.businesses.id, id));
        expect([row.approvalStatus, row.isOpen]).toEqual(["pending", false]);
      });
      it("mover el pin en pasos pequeños no evita la revisión: se mide contra la última ubicación aprobada", async () => {
        const owner = await mkUser("business");
        const id = await mkBusiness(owner.id, { lat: -2.14, lng: -79.59 });
        const first = await callerFor(owner).business.setLocation({ lat: -2.1425, lng: -79.59 }); // ~277 m
        expect(first.needsReview).toBe(false);
        const second = await callerFor(owner).business.setLocation({ lat: -2.145, lng: -79.59 }); // ~277 m más, ~554 m del punto aprobado
        expect(second.needsReview).toBe(true);
        const [row] = await db.select().from(S.businesses).where(eq(S.businesses.id, id));
        expect([row.approvalStatus, row.isOpen]).toEqual(["pending", false]);
      });
      it("la PRIMERA confirmación de un local antiguo (ubicación inventada) no lo manda a revisión", async () => {
        const owner = await mkUser("business");
        const id = await mkBusiness(owner.id, { lat: -2.134, lng: -79.594, locationConfirmed: false });
        const r = await callerFor(owner).business.setLocation({ lat: -2.16, lng: -79.61 });
        expect(r.needsReview).toBe(false);
        const [row] = await db.select().from(S.businesses).where(eq(S.businesses.id, id));
        expect([row.approvalStatus, row.locationConfirmed, row.lat]).toEqual(["approved", true, -2.16]);
      });
      it("rechaza ubicaciones fuera de la zona", async () => {
        const owner = await mkUser("business");
        await mkBusiness(owner.id);
        expect((await failure(callerFor(owner).business.setLocation({ lat: -0.18, lng: -78.47 }))).code).toBe("BAD_REQUEST");
      });
    });

    describe("un local sin ubicación confirmada", () => {
      it("no aparece en el catálogo ni en su ficha pública", async () => {
        const owner = await mkUser("business");
        const id = await mkBusiness(owner.id, { name: `${tag}-sinubic`, locationConfirmed: false });
        const customer = callerFor(await mkUser("customer"));
        expect(await customer.catalog.businesses({ query: `${tag}-sinubic` })).toEqual([]);
        expect(await customer.catalog.businessDetail({ id })).toBeNull();
        expect(await callerFor(owner).catalog.businessDetail({ id })).not.toBeNull(); // el dueño sí lo ve
      });
      it("no se le puede pedir delivery ni cotizar", async () => {
        const owner = await mkUser("business");
        const id = await mkBusiness(owner.id, { locationConfirmed: false });
        const prod = await mkProduct(id);
        const customer = callerFor(await mkUser("customer"));
        const dest = { deliveryLat: -2.139, deliveryLng: -79.588 };
        expect((await failure(customer.orders.createDelivery({ businessId: id, items: [{ productId: prod, quantity: 1 }], deliveryAddress: "Av. Cliente 456", ...dest }))).code).toBeDefined();
        expect((await failure(customer.orders.quote({ businessId: id, lat: dest.deliveryLat, lng: dest.deliveryLng }))).code).toBe("NOT_FOUND");
      });
      it("no puede abrirse", async () => {
        const owner = await mkUser("business");
        await mkBusiness(owner.id, { locationConfirmed: false, isOpen: false });
        const e = await failure(callerFor(owner).business.toggleOpen({ isOpen: true }));
        expect(e.message).toMatch(/ubicación/i);
      });
      it("el admin no puede aprobarlo", async () => {
        const owner = await mkUser("business");
        const id = await mkBusiness(owner.id, { approvalStatus: "pending", locationConfirmed: false });
        const e = await failure(callerFor(await mkAdmin()).admin.reviewBusiness({ id, decision: "approved" }));
        expect(e.code).toBe("BAD_REQUEST");
        const ok = await mkBusiness((await mkUser("business")).id, { approvalStatus: "pending" });
        expect((await callerFor(await mkAdmin()).admin.reviewBusiness({ id: ok, decision: "approved" })).ok).toBe(true);
      });
    });

    it("un local con ubicación confirmada sí recibe pedidos (cotización con su ubicación real)", async () => {
      const owner = await mkUser("business");
      const id = await mkBusiness(owner.id);
      const q = await callerFor(await mkUser("customer")).orders.quote({ businessId: id, lat: -2.139, lng: -79.588 });
      expect(q.openNow).toBe(true);
    });
  });

  // ------------------------------------------------------------------ rescates de locales no públicos
  it("no se puede reservar un pack de un local suspendido llamando a la API directamente", async () => {
    const owner = await mkUser("business");
    const biz = await mkBusiness(owner.id, { approvalStatus: "rejected" });
    const [{ id: packId }] = await db.insert(S.rescuePacks).values({
      businessId: biz, title: `${tag} pack`, originalPrice: 10, rescuePrice: 4, quantityTotal: 3, quantityLeft: 3, pickupStart: "00:00", pickupEnd: "00:00", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).$returningId();
    try {
      const e = await failure(callerFor(await mkUser("customer")).orders.createRescue({ rescuePackId: packId, quantity: 1 }));
      expect(e.code).toBe("BAD_REQUEST");
      expect((await db.select().from(S.rescuePacks).where(eq(S.rescuePacks.id, packId)))[0].quantityLeft).toBe(3);
    } finally {
      await db.delete(S.rescuePacks).where(eq(S.rescuePacks.id, packId));
    }
  });

  describe("packs: validación de horas", () => {
    const pack = (over: Record<string, unknown> = {}) => ({
      title: `${tag} pack`, originalPrice: 6, rescuePrice: 2, quantityTotal: 3, pickupStart: "19:00", pickupEnd: "20:30", ...over,
    });
    it("rechaza horas inexistentes como 99:99 o 25:00 (antes creaban packs que nunca vencían)", async () => {
      const owner = await mkUser("business");
      await mkBusiness(owner.id);
      for (const bad of ["99:99", "25:00", "12:60", "7:30"]) {
        expect((await failure(callerFor(owner).business.createRescuePack(pack({ pickupEnd: bad })))).code).toBe("BAD_REQUEST");
      }
      expect((await failure(callerFor(owner).business.createRescuePack(pack({ quantityTotal: 1.5 })))).code).toBe("BAD_REQUEST");
    });
    it("acepta horas válidas", async () => {
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const { id } = await callerFor(owner).business.createRescuePack(pack());
      await db.delete(S.rescuePacks).where(eq(S.rescuePacks.id, id));
      expect(biz).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------ privacidad del cliente
  describe("tablero de pedidos disponibles del repartidor", () => {
    async function readyOrder() {
      const owner = await mkUser("business");
      const customer = await mkUser("customer");
      const businessId = await mkBusiness(owner.id);
      const orderId = await mkOrder({
        customerId: customer.id, businessId, status: "ready", customerName: "Juan Pérez Secreto", customerPhone: "0991234567",
        deliveryAddress: "Av. Secreta 123 y Calle 9", deliveryLat: -2.1391, deliveryLng: -79.5881, notes: "timbre dañado",
        deliveryDistanceKm: 2.3, deliveryFee: 1.75, total: 8.25,
      });
      return { orderId, customer, courier: await mkUser("courier") };
    }
    it("antes de aceptar NO muestra teléfono, nombre, dirección, coordenadas ni notas", async () => {
      const { orderId, courier } = await readyOrder();
      const board = await callerFor(courier).courier.available();
      const seen = board.find((x) => x.order.id === orderId)!.order;
      expect(seen).toBeDefined();
      expect(seen.customerPhone).toBeNull();
      expect(seen.customerName).toBe("Cliente");
      expect(seen.deliveryAddress).toBe("");
      expect(seen.deliveryLat).toBeNull();
      expect(seen.deliveryLng).toBeNull();
      expect(seen.notes).toBeNull();
      expect(JSON.stringify(board.find((x) => x.order.id === orderId))).not.toMatch(/Secreta|0991234567|Juan|-2\.1391|timbre/);
    });
    it("sí muestra lo necesario para decidir: ganancia, distancia y cuánto cobrar", async () => {
      const { orderId, courier } = await readyOrder();
      const seen = (await callerFor(courier).courier.available()).find((x) => x.order.id === orderId)!.order;
      expect([seen.deliveryFee, seen.deliveryDistanceKm, seen.total]).toEqual([1.75, 2.3, 8.25]);
    });
    it("al aceptar, el repartidor ya ve los datos completos para entregar", async () => {
      const { orderId, courier } = await readyOrder();
      await callerFor(courier).courier.accept({ orderId });
      const mine = (await callerFor(courier).courier.myDeliveries()).find((x) => x.order.id === orderId)!.order;
      expect([mine.customerPhone, mine.deliveryAddress, mine.deliveryLat]).toEqual(["0991234567", "Av. Secreta 123 y Calle 9", -2.1391]);
      expect(mine.deliveryConfirmationCode).toBeNull(); // el código sigue siendo solo del cliente
      expect(mine.courierPickupCode).toBeNull(); // el código de recogida se valida sin entregárselo al repartidor
    });
  });

  // ------------------------------------------------------------------ código de entrega (delivery)
  describe("código de entrega: límite de intentos", () => {
    async function inTransit(over: Partial<typeof S.orders.$inferInsert> = {}) {
      const owner = await mkUser("business");
      const customer = await mkUser("customer");
      const courier = await mkUser("courier");
      const businessId = await mkBusiness(owner.id);
      const orderId = await mkOrder({
        customerId: customer.id, businessId, courierId: courier.id, status: "picked_up",
        deliveryConfirmationCode: "123456", courierAcceptedAt: new Date(), ...over,
      });
      return { orderId, owner, customer, courier };
    }
    const wrong = (i: number) => String(100000 + i).replace("123456", "999999");

    it("un código incorrecto avisa cuántos intentos quedan", async () => {
      const { orderId, courier } = await inTransit();
      const e = await failure(callerFor(courier).courier.markDelivered({ orderId, confirmationCode: "000000" }));
      expect(e.code).toBe("BAD_REQUEST");
      expect(e.message).toMatch(/Te quedan 4 intentos/);
    });
    it("tras 5 intentos fallidos se bloquea, aunque el sexto sea el código correcto", async () => {
      const { orderId, courier } = await inTransit();
      const c = callerFor(courier);
      for (let i = 0; i < 5; i++) await failure(c.courier.markDelivered({ orderId, confirmationCode: wrong(i) }));
      const e = await failure(c.courier.markDelivered({ orderId, confirmationCode: "123456" }));
      expect(e.code).toBe("TOO_MANY_REQUESTS");
      const o = await getOrder(orderId);
      expect([o.status, o.codeAttempts]).toEqual(["picked_up", 5]);
    });
    it("100 intentos en paralelo: solo 5 llegan a comprobarse", async () => {
      const { orderId, courier } = await inTransit();
      const c = callerFor(courier);
      const results = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => c.courier.markDelivered({ orderId, confirmationCode: wrong(i) })));
      const compared = results.filter((r) => r.status === "rejected" && (r.reason as { code: string }).code === "BAD_REQUEST").length;
      const blocked = results.filter((r) => r.status === "rejected" && (r.reason as { code: string }).code === "TOO_MANY_REQUESTS").length;
      expect(compared).toBe(5);
      expect(blocked).toBe(95);
      expect((await getOrder(orderId)).codeAttempts).toBe(5);
    });
    it("el código correcto dentro de los intentos confirma la entrega", async () => {
      const { orderId, courier } = await inTransit();
      const c = callerFor(courier);
      await failure(c.courier.markDelivered({ orderId, confirmationCode: "000000" }));
      expect((await c.courier.markDelivered({ orderId, confirmationCode: "123456" })).ok).toBe(true);
      const o = await getOrder(orderId);
      expect([o.status, o.deliveryConfirmationCode]).toEqual(["delivered", null]);
    });
    it("el cliente genera un código nuevo: se reinician los intentos y el código viejo deja de servir", async () => {
      const { orderId, courier, customer } = await inTransit();
      const c = callerFor(courier);
      for (let i = 0; i < 5; i++) await failure(c.courier.markDelivered({ orderId, confirmationCode: wrong(i) }));
      await callerFor(customer).orders.regenerateCode({ id: orderId });
      const o = await getOrder(orderId);
      expect(o.codeAttempts).toBe(0);
      expect(o.deliveryConfirmationCode).toMatch(/^\d{6}$/);
      expect(o.deliveryConfirmationCode).not.toBe("123456");
      expect((await failure(c.courier.markDelivered({ orderId, confirmationCode: "123456" }))).code).toBe("BAD_REQUEST"); // el viejo ya no sirve
      expect((await c.courier.markDelivered({ orderId, confirmationCode: o.deliveryConfirmationCode! })).ok).toBe(true);
    });
    it("solo el cliente dueño puede generar un código nuevo", async () => {
      const { orderId, courier, owner } = await inTransit();
      expect((await failure(callerFor(courier).orders.regenerateCode({ id: orderId }))).code).toBe("BAD_REQUEST");
      expect((await failure(callerFor(owner).orders.regenerateCode({ id: orderId }))).code).toBe("BAD_REQUEST");
      expect((await failure(callerFor(await mkUser("customer")).orders.regenerateCode({ id: orderId }))).code).toBe("BAD_REQUEST");
      expect((await getOrder(orderId)).deliveryConfirmationCode).toBe("123456");
    });
    it("el cliente ve el código y los intentos; el comercio no ve el código", async () => {
      const { orderId, customer, owner, courier } = await inTransit({ codeAttempts: 2 });
      const mine = (await callerFor(customer).orders.byId({ id: orderId }))!.order;
      expect([mine.deliveryConfirmationCode, mine.codeAttempts]).toEqual(["123456", 2]);
      expect((await callerFor(owner).orders.byId({ id: orderId }))!.order.deliveryConfirmationCode).toBeNull();
      expect((await callerFor(courier).orders.byId({ id: orderId }))!.order.deliveryConfirmationCode).toBeNull();
    });
    it("soltar el pedido reinicia los intentos y borra el código", async () => {
      const { orderId, courier } = await inTransit({ codeAttempts: 3 });
      await callerFor(courier).courier.release({ orderId, reason: "Se me averió la moto" });
      const o = await getOrder(orderId);
      expect([o.status, o.codeAttempts, o.deliveryConfirmationCode]).toEqual(["ready", 0, null]);
    });
    it("otro repartidor no puede confirmar una entrega ajena ni gastar sus intentos", async () => {
      const { orderId } = await inTransit();
      const intruder = await mkUser("courier");
      expect((await failure(callerFor(intruder).courier.markDelivered({ orderId, confirmationCode: "123456" }))).code).toBe("BAD_REQUEST");
      expect((await getOrder(orderId)).codeAttempts).toBe(0);
    });
  });

  // ------------------------------------------------------------------ código de retiro (rescate)
  describe("código de retiro de un rescate", () => {
    async function rescue(over: Partial<typeof S.orders.$inferInsert> = {}) {
      const owner = await mkUser("business");
      const customer = await mkUser("customer");
      const businessId = await mkBusiness(owner.id);
      const orderId = await mkOrder({ customerId: customer.id, businessId, type: "rescue", status: "ready", pickupCode: "654321", ...over });
      return { orderId, owner, customer };
    }
    const deliver = (owner: User, orderId: number, pickupCode?: string) =>
      callerFor(owner).business.updateOrderStatus({ orderId, status: "delivered", ...(pickupCode ? { pickupCode } : {}) });

    it("el comercio NO ve el código en su lista ni en el detalle; el cliente sí", async () => {
      const { orderId, owner, customer } = await rescue();
      const list = await callerFor(owner).business.orders({ activeOnly: true });
      expect(list.find((x) => x.order.id === orderId)!.order.pickupCode).toBeNull();
      expect((await callerFor(owner).orders.byId({ id: orderId }))!.order.pickupCode).toBeNull();
      expect((await callerFor(customer).orders.byId({ id: orderId }))!.order.pickupCode).toBe("654321");
    });
    it("entregar sin pedir el código es rechazado", async () => {
      const { orderId, owner } = await rescue();
      const e = await failure(deliver(owner, orderId));
      expect(e.code).toBe("BAD_REQUEST");
      expect((await getOrder(orderId)).status).toBe("ready");
    });
    it("con el código correcto se entrega", async () => {
      const { orderId, owner } = await rescue();
      expect((await deliver(owner, orderId, "654321")).ok).toBe(true);
      expect((await getOrder(orderId)).status).toBe("delivered");
    });
    it("un código incorrecto no entrega y avisa los intentos restantes", async () => {
      const { orderId, owner } = await rescue();
      const e = await failure(deliver(owner, orderId, "000000"));
      expect(e.message).toMatch(/Te quedan 4 intentos/);
      expect((await getOrder(orderId)).status).toBe("ready");
    });
    it("tras 5 fallos se bloquea; 100 intentos en paralelo solo comprueban 5", async () => {
      const { orderId, owner } = await rescue();
      const results = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => deliver(owner, orderId, String(100000 + i))));
      expect(results.filter((r) => r.status === "rejected" && (r.reason as { code: string }).code === "BAD_REQUEST").length).toBe(5);
      expect((await failure(deliver(owner, orderId, "654321"))).code).toBe("TOO_MANY_REQUESTS");
      expect((await getOrder(orderId)).status).toBe("ready");
    });
    it("el cliente genera un código nuevo y el local puede entregar con él", async () => {
      const { orderId, owner, customer } = await rescue({ codeAttempts: 5 });
      await callerFor(customer).orders.regenerateCode({ id: orderId });
      const o = await getOrder(orderId);
      expect([o.codeAttempts, o.pickupCode === "654321"]).toEqual([0, false]);
      expect((await deliver(owner, orderId, o.pickupCode!)).ok).toBe(true);
    });
    it("un pedido antiguo sin código de retiro puede entregarse como antes", async () => {
      const { orderId, owner } = await rescue({ pickupCode: null });
      expect((await deliver(owner, orderId)).ok).toBe(true);
    });
  });
  // ------------------------------------------------------------ eliminar cuenta
  describe("deleteAccount (derecho de supresión)", () => {
    it("exige escribir la palabra de confirmación", async () => {
      const u = await mkUser("customer");
      await expect(callerFor(u).auth.deleteAccount({ confirmation: "eliminar" as "ELIMINAR" })).rejects.toBeTruthy();
    });
    it("no deja eliminar con un pedido en curso", async () => {
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const customer = await mkUser("customer");
      await mkOrder({ customerId: customer.id, businessId: biz, status: "preparing" });
      expect((await failure(callerFor(customer).auth.deleteAccount({ confirmation: "ELIMINAR" }))).code).toBe("PRECONDITION_FAILED");
    });
    it("no deja eliminar una cuenta de administrador", async () => {
      const admin = await mkAdmin();
      expect((await failure(callerFor(admin).auth.deleteAccount({ confirmation: "ELIMINAR" }))).code).toBe("PRECONDITION_FAILED");
    });
    it("anonimiza al cliente y conserva el pedido sin sus datos personales", async () => {
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      const customer = await mkUser("customer");
      await db.update(S.users).set({ email: `${tag}-c@test.local`, phone: "0990000000", passwordHash: "x" }).where(eq(S.users.id, customer.id));
      await db.insert(S.customerAddresses).values({ userId: customer.id, label: "Casa", address: "Calle 9", lat: -2.13, lng: -79.59 });
      const orderId = await mkOrder({ customerId: customer.id, businessId: biz, status: "delivered", customerName: "Ana", customerPhone: "0990000000", deliveryLat: -2.13, deliveryLng: -79.59, notes: "timbre roto" });
      const fresh = (await db.select().from(S.users).where(eq(S.users.id, customer.id)))[0];
      await callerFor(fresh).auth.deleteAccount({ confirmation: "ELIMINAR" });

      const [u] = await db.select().from(S.users).where(eq(S.users.id, customer.id));
      expect([u.email, u.phone, u.passwordHash, u.name]).toEqual([null, null, null, "Cuenta eliminada"]);
      expect(u.deletedAt).not.toBeNull();
      expect(u.unionId.startsWith("deleted:")).toBe(true);
      expect(u.sessionVersion).toBe(fresh.sessionVersion + 1);
      expect(await db.select().from(S.customerAddresses).where(eq(S.customerAddresses.userId, customer.id))).toHaveLength(0);
      const o = await getOrder(orderId);
      expect([o.customerName, o.customerPhone, o.deliveryAddress, o.deliveryLat, o.notes]).toEqual(["Cuenta eliminada", null, null, null, null]);
      expect(o.total).toBe(6); // el historial contable se conserva
    });
    it("al eliminar al dueño, el comercio deja de publicarse", async () => {
      const owner = await mkUser("business");
      const biz = await mkBusiness(owner.id);
      await callerFor(owner).auth.deleteAccount({ confirmation: "ELIMINAR" });
      const [b] = await db.select().from(S.businesses).where(eq(S.businesses.id, biz));
      expect([b.isOpen, b.approvalStatus]).toEqual([false, "rejected"]);
    });
  });
});

