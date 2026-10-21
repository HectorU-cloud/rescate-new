/**
 * Pruebas de integración (MySQL real) de las claves foráneas: que existan en la base con la regla
 * correcta, que impidan datos inconsistentes, que cada regla de borrado haga lo esperado y que el
 * chequeo de huérfanos (npm run db:check) detecte y explique los problemas de una base antigua.
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { eq, inArray, like, sql, type SQL } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("claves foráneas (MySQL real)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let orphansLib: typeof import("@db/orphans");

  const tag = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let seq = 0;
  const ids = { users: [] as number[], businesses: [] as number[], orders: [] as number[] };
  const GHOST = 4_000_000_000; // un id que no existe en ninguna tabla

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    db = (await import("./queries/connection")).getDb();
    S = await import("@db/schema");
    orphansLib = await import("@db/orphans");
  });

  afterAll(async () => {
    if (!db) return;
    // Primero lo que depende de otras cosas: pedidos (borra en cascada sus datos), luego comercios y usuarios
    await db.delete(S.orders).where(like(S.orders.code, `${tag}-%`));
    const bizIds = (await db.select({ id: S.businesses.id }).from(S.businesses).where(like(S.businesses.name, `${tag}%`))).map((b) => b.id);
    if (bizIds.length) await db.delete(S.businesses).where(inArray(S.businesses.id, bizIds));
    const userIds = (await db.select({ id: S.users.id }).from(S.users).where(like(S.users.unionId, `${tag}-%`))).map((u) => u.id);
    if (userIds.length) await db.delete(S.users).where(inArray(S.users.id, userIds));
  });

  // ------------------------------------------------------------------ ayudantes
  async function mkUser() {
    const [{ id }] = await db.insert(S.users).values({ unionId: `${tag}-u${seq++}`, name: `${tag} user` }).$returningId();
    ids.users.push(id);
    return id;
  }
  async function mkBusiness(ownerId: number) {
    const [{ id }] = await db.insert(S.businesses).values({ ownerId, name: `${tag} local ${seq++}`, category: "t", address: "Calle 1", lat: -2.13, lng: -79.59 }).$returningId();
    ids.businesses.push(id);
    return id;
  }
  async function mkOrder(customerId: number, businessId: number, over: Partial<typeof S.orders.$inferInsert> = {}) {
    const [{ id }] = await db.insert(S.orders).values({ code: `${tag}-${seq++}`, type: "delivery", status: "ready", customerId, businessId, subtotal: 5, total: 6, deliveryFee: 1, deliveryAddress: "Calle 2", ...over }).$returningId();
    ids.orders.push(id);
    return id;
  }
  const errText = (e: unknown) => { const x = e as { message?: string; cause?: { message?: string; code?: string } }; return `${x?.message ?? ""} ${x?.cause?.message ?? ""} ${x?.cause?.code ?? ""}`; };
  async function fkError(p: Promise<unknown>) {
    try { await p; } catch (e) { return errText(e); }
    throw new Error("se esperaba un error de clave foránea y la operación tuvo éxito");
  }
  const NO_PARENT = /foreign key constraint fails|ER_NO_REFERENCED_ROW/i;
  const HAS_CHILDREN = /foreign key constraint fails|ER_ROW_IS_REFERENCED/i;
  const count = async (table: MySqlTable, where: SQL | undefined) => Number((await db.select({ n: sql<number>`COUNT(*)` }).from(table).where(where))[0].n);
  /** Un pedido con todo lo que puede colgar de él. */
  async function fullOrder() {
    const customer = await mkUser(); const owner = await mkUser(); const courier = await mkUser(); const admin = await mkUser();
    const biz = await mkBusiness(owner);
    const orderId = await mkOrder(customer, biz, { courierId: courier, status: "picked_up" });
    await db.insert(S.orderItems).values({ orderId, name: "Hamburguesa", unitPrice: 3, quantity: 2 });
    await db.insert(S.orderEvents).values({ orderId, actorId: courier, actorRole: "courier", type: "accepted" });
    await db.insert(S.orderMessages).values({ orderId, courierId: courier, senderId: customer, senderRole: "customer", body: "hola" });
    await db.insert(S.courierLocations).values({ orderId, courierId: courier, lat: -2.1, lng: -79.5 });
    await db.insert(S.claims).values({ orderId, userId: customer, reporterRole: "customer", reason: "tardó mucho", resolvedBy: admin });
    await db.insert(S.ratings).values({ orderId, customerId: customer, businessId: biz, courierId: courier, businessStars: 5 });
    return { customer, owner, courier, admin, biz, orderId };
  }

  // ================================================================== existen en la base
  it("las claves foráneas del esquema existen en la base de datos con la regla de borrado correcta", async () => {
    const res = (await db.execute(sql`
      SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, k.REFERENCED_TABLE_NAME AS pt, k.REFERENCED_COLUMN_NAME AS pc, r.DELETE_RULE AS rule
      FROM information_schema.KEY_COLUMN_USAGE k
      JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
      WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`)) as unknown as Array<Array<{ t: string; c: string; pt: string; pc: string; rule: string }>>;
    const inDb = res[0].map((r) => `${r.t}.${r.c} -> ${r.pt}.${r.pc} (${r.rule.toLowerCase()})`).sort();
    const declared = orphansLib.declaredForeignKeys().map((f) => `${f.table}.${f.column} -> ${f.parentTable}.${f.parentColumn} (${f.onDelete})`).sort();
    expect(inDb).toEqual(declared);
    expect(declared).toHaveLength(26);
  });

  // ================================================================== impiden datos inconsistentes
  describe("no permiten filas que apunten a algo que no existe", () => {
    it("pedidos de un cliente o de un comercio inexistente", async () => {
      const owner = await mkUser(); const biz = await mkBusiness(owner); const user = await mkUser();
      const base = { code: `${tag}-x${seq++}`, type: "delivery" as const, subtotal: 1, total: 1, deliveryFee: 0, deliveryAddress: "Calle 3" };
      expect(await fkError(db.insert(S.orders).values({ ...base, customerId: GHOST, businessId: biz }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.orders).values({ ...base, code: `${tag}-x${seq++}`, customerId: user, businessId: GHOST }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.orders).values({ ...base, code: `${tag}-x${seq++}`, customerId: user, businessId: biz, courierId: GHOST }))).toMatch(NO_PARENT);
    });
    it("comercio de un dueño inexistente; producto o pack de un comercio inexistente", async () => {
      expect(await fkError(db.insert(S.businesses).values({ ownerId: GHOST, name: `${tag} x`, category: "t", address: "a", lat: 0, lng: 0 }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.products).values({ businessId: GHOST, name: "x", price: 1 }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.rescuePacks).values({ businessId: GHOST, title: "x", originalPrice: 2, rescuePrice: 1, quantityTotal: 1, quantityLeft: 1, pickupStart: "10:00", pickupEnd: "11:00" }))).toMatch(NO_PARENT);
    });
    it("datos de un pedido inexistente (ítems, eventos, mensajes, ubicación, reclamos, valoraciones)", async () => {
      const u = await mkUser(); const owner = await mkUser(); const biz = await mkBusiness(owner);
      expect(await fkError(db.insert(S.orderItems).values({ orderId: GHOST, name: "x", unitPrice: 1, quantity: 1 }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.orderEvents).values({ orderId: GHOST, actorRole: "system", type: "x" }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.orderMessages).values({ orderId: GHOST, courierId: u, senderId: u, senderRole: "customer", body: "x" }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.courierLocations).values({ orderId: GHOST, courierId: u, lat: 0, lng: 0 }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.claims).values({ orderId: GHOST, userId: u, reporterRole: "customer", reason: "x" }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.ratings).values({ orderId: GHOST, customerId: u, businessId: biz, businessStars: 5 }))).toMatch(NO_PARENT);
    });
    it("datos de un usuario inexistente (tokens, direcciones, notificaciones)", async () => {
      expect(await fkError(db.insert(S.authTokens).values({ userId: GHOST, tokenHash: `${tag}${"a".repeat(30)}`, purpose: "verify_email", expiresAt: new Date(Date.now() + 1000) }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.pushTokens).values({ userId: GHOST, token: `${tag}-tok` }))).toMatch(NO_PARENT);
      expect(await fkError(db.insert(S.customerAddresses).values({ userId: GHOST, address: "Calle 1", lat: 0, lng: 0 }))).toMatch(NO_PARENT);
    });
  });

  // ================================================================== reglas de borrado
  describe("reglas de borrado", () => {
    it("borrar un pedido borra en cascada todo lo que cuelga de él", async () => {
      const { orderId } = await fullOrder();
      const children = [S.orderItems, S.orderEvents, S.orderMessages, S.courierLocations, S.claims, S.ratings] as const;
      for (const t of children) expect(await count(t, eq(t.orderId, orderId))).toBe(1);
      await db.delete(S.orders).where(eq(S.orders.id, orderId));
      for (const t of children) expect(await count(t, eq(t.orderId, orderId))).toBe(0);
    });

    it("no se puede borrar un usuario que tiene pedidos, comercio, mensajes, reclamos o valoraciones", async () => {
      const f = await fullOrder();
      for (const [who, id] of [["cliente con pedidos", f.customer], ["dueño de un comercio", f.owner]] as const) {
        expect(await fkError(db.delete(S.users).where(eq(S.users.id, id))), who).toMatch(HAS_CHILDREN);
      }
      // el repartidor tiene mensajes (RESTRICT): tampoco
      expect(await fkError(db.delete(S.users).where(eq(S.users.id, f.courier)))).toMatch(HAS_CHILDREN);
      expect((await db.select().from(S.users).where(eq(S.users.id, f.customer))).length).toBe(1);
    });

    it("no se puede borrar un comercio que tiene pedidos o valoraciones", async () => {
      const f = await fullOrder();
      expect(await fkError(db.delete(S.businesses).where(eq(S.businesses.id, f.biz)))).toMatch(HAS_CHILDREN);
      expect((await db.select().from(S.orders).where(eq(S.orders.id, f.orderId))).length).toBe(1);
    });

    it("borrar un comercio sin pedidos borra sus productos y packs", async () => {
      const owner = await mkUser(); const biz = await mkBusiness(owner);
      await db.insert(S.products).values({ businessId: biz, name: "Plato", price: 3 });
      await db.insert(S.rescuePacks).values({ businessId: biz, title: "Pack", originalPrice: 6, rescuePrice: 2, quantityTotal: 1, quantityLeft: 1, pickupStart: "10:00", pickupEnd: "11:00" });
      await db.delete(S.businesses).where(eq(S.businesses.id, biz));
      expect(await count(S.products, eq(S.products.businessId, biz))).toBe(0);
      expect(await count(S.rescuePacks, eq(S.rescuePacks.businessId, biz))).toBe(0);
    });

    it("borrar un producto o un pack conserva el historial del pedido (el ítem queda sin enlace pero con su nombre y precio)", async () => {
      const customer = await mkUser(); const owner = await mkUser(); const biz = await mkBusiness(owner);
      const [{ id: productId }] = await db.insert(S.products).values({ businessId: biz, name: "Plato", price: 3 }).$returningId();
      const [{ id: packId }] = await db.insert(S.rescuePacks).values({ businessId: biz, title: "Pack", originalPrice: 6, rescuePrice: 2, quantityTotal: 1, quantityLeft: 1, pickupStart: "10:00", pickupEnd: "11:00" }).$returningId();
      const orderId = await mkOrder(customer, biz);
      await db.insert(S.orderItems).values([{ orderId, productId, name: "Plato", unitPrice: 3, quantity: 1 }, { orderId, rescuePackId: packId, name: "Pack", unitPrice: 2, quantity: 1 }]);
      await db.delete(S.products).where(eq(S.products.id, productId));
      await db.delete(S.rescuePacks).where(eq(S.rescuePacks.id, packId));
      const items = await db.select().from(S.orderItems).where(eq(S.orderItems.orderId, orderId));
      expect(items.map((i) => [i.name, i.unitPrice, i.productId, i.rescuePackId])).toEqual([["Plato", 3, null, null], ["Pack", 2, null, null]]);
    });

    it("borrar a un repartidor sin mensajes deja sus pedidos sin repartidor y borra su ubicación y sus notificaciones", async () => {
      const customer = await mkUser(); const owner = await mkUser(); const courier = await mkUser(); const biz = await mkBusiness(owner);
      const orderId = await mkOrder(customer, biz, { courierId: courier, status: "picked_up" });
      await db.insert(S.courierLocations).values({ orderId, courierId: courier, lat: -2.1, lng: -79.5 });
      await db.insert(S.pushTokens).values({ userId: courier, token: `${tag}-push-${seq++}` });
      await db.insert(S.orderEvents).values({ orderId, actorId: courier, actorRole: "courier", type: "accepted" });
      await db.insert(S.ratings).values({ orderId, customerId: customer, businessId: biz, courierId: courier, businessStars: 4 });
      await db.delete(S.users).where(eq(S.users.id, courier));
      const [order] = await db.select().from(S.orders).where(eq(S.orders.id, orderId));
      expect([order.courierId, order.status]).toEqual([null, "picked_up"]);
      expect(await count(S.courierLocations, eq(S.courierLocations.orderId, orderId))).toBe(0);
      expect(await count(S.pushTokens, eq(S.pushTokens.userId, courier))).toBe(0);
      const [ev] = await db.select().from(S.orderEvents).where(eq(S.orderEvents.orderId, orderId));
      expect(ev.actorId).toBeNull(); // el registro de lo ocurrido se conserva
      const [rating] = await db.select().from(S.ratings).where(eq(S.ratings.orderId, orderId));
      expect([rating.courierId, rating.businessStars]).toEqual([null, 4]);
    });

    it("borrar al admin que resolvió un reclamo conserva el reclamo", async () => {
      const f = await fullOrder();
      await db.delete(S.users).where(eq(S.users.id, f.admin));
      const [claim] = await db.select().from(S.claims).where(eq(S.claims.orderId, f.orderId));
      expect([claim.resolvedBy, claim.reason]).toEqual([null, "tardó mucho"]);
    });

    it("borrar un usuario sin historial borra sus tokens y direcciones", async () => {
      const u = await mkUser();
      await db.insert(S.authTokens).values({ userId: u, tokenHash: `${tag}${"b".repeat(30)}${seq++}`.slice(0, 64), purpose: "reset_password", expiresAt: new Date(Date.now() + 1000) });
      await db.insert(S.pushTokens).values({ userId: u, token: `${tag}-push-${seq++}` });
      await db.insert(S.customerAddresses).values({ userId: u, address: "Calle 9", lat: -2.1, lng: -79.5 });
      await db.delete(S.users).where(eq(S.users.id, u));
      expect(await count(S.authTokens, eq(S.authTokens.userId, u))).toBe(0);
      expect(await count(S.pushTokens, eq(S.pushTokens.userId, u))).toBe(0);
      expect(await count(S.customerAddresses, eq(S.customerAddresses.userId, u))).toBe(0);
    });
  });

  // ================================================================== chequeo de huérfanos
  describe("chequeo de datos huérfanos (npm run db:check)", () => {
    const countsOf = (found: Awaited<ReturnType<typeof orphansLib.findOrphans>>) => Object.fromEntries(found.map((o) => [`${o.table}.${o.column}`, o.count]));
    /** Planta filas huérfanas (solo posible con las comprobaciones desactivadas) en la misma conexión. */
    async function plantOrphans() {
      const customer = await mkUser(); const owner = await mkUser(); const biz = await mkBusiness(owner);
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
        try {
          await tx.insert(S.orderItems).values({ orderId: GHOST, name: "huérfano", unitPrice: 1, quantity: 1 }); // regla: cascade
          await tx.insert(S.orders).values({ code: `${tag}-o${seq++}`, type: "delivery", status: "ready", customerId: customer, businessId: biz, courierId: GHOST, subtotal: 1, total: 1, deliveryFee: 0, deliveryAddress: "Calle 5" }); // set null
          await tx.insert(S.orders).values({ code: `${tag}-o${seq++}`, type: "delivery", status: "ready", customerId: GHOST, businessId: biz, subtotal: 1, total: 1, deliveryFee: 0, deliveryAddress: "Calle 6" }); // restrict
        } finally {
          await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
        }
      });
    }

    it("en una base consistente no encuentra nada y dice que se puede hacer db:push", async () => {
      const found = await orphansLib.findOrphans(db);
      expect(found).toHaveLength(26);
      expect(found.filter((o) => o.count > 0)).toEqual([]);
      expect(orphansLib.formatOrphanReport(found)).toContain("No hay datos huérfanos");
    });

    it("detecta datos huérfanos, los explica con la consulta y el arreglo según la regla, y el arreglo funciona", async () => {
      const before = countsOf(await orphansLib.findOrphans(db));
      await plantOrphans();
      const found = await orphansLib.findOrphans(db);
      const after = countsOf(found);
      expect(after["order_items.orderId"] - before["order_items.orderId"]).toBe(1);
      expect(after["orders.courierId"] - before["orders.courierId"]).toBe(1);
      expect(after["orders.customerId"] - before["orders.customerId"]).toBe(1);

      const report = orphansLib.formatOrphanReport(found);
      expect(report).toContain("order_items.orderId → orders.id");
      expect(report).toContain("regla: cascade");
      expect(report).toContain("Haz una copia de seguridad");

      // Cascade → se borran las filas huérfanas; set null → se desvinculan; restrict → revisión manual
      const byKey = Object.fromEntries(found.map((o) => [`${o.table}.${o.column}`, o]));
      expect(byKey["order_items.orderId"].fixSql).toMatch(/^DELETE c /);
      expect(byKey["orders.courierId"].fixSql).toMatch(/^UPDATE .* SET c\.`courierId` = NULL/);
      expect(byKey["orders.customerId"].fixSql).toContain("Revisa a mano");

      await db.execute(sql.raw(byKey["order_items.orderId"].fixSql));
      await db.execute(sql.raw(byKey["orders.courierId"].fixSql));
      const fixed = countsOf(await orphansLib.findOrphans(db));
      expect(fixed["order_items.orderId"]).toBe(before["order_items.orderId"]);
      expect(fixed["orders.courierId"]).toBe(before["orders.courierId"]);
      expect(fixed["orders.customerId"]).toBe(after["orders.customerId"]); // la de regla 'restrict' queda para revisar a mano
      // el pedido con repartidor inexistente se conserva (solo pierde el enlace)
      expect(await count(S.orders, like(S.orders.deliveryAddress, "Calle 5"))).toBeGreaterThanOrEqual(1);
      // limpieza de lo plantado
      await db.execute(sql`DELETE FROM orders WHERE customerId = ${GHOST}`);
      expect(countsOf(await orphansLib.findOrphans(db))["orders.customerId"]).toBe(before["orders.customerId"]);
    });

    it("el comando npm run db:check sale con error y explica cuando hay huérfanos, y sale bien cuando no", async () => {
      const run = () => spawnSync("npx", ["tsx", "db/check-orphans.ts"], {
        cwd: process.cwd(), encoding: "utf8", shell: process.platform === "win32",
        env: { ...process.env, DATABASE_URL: TEST_URL!, APP_SECRET: process.env.APP_SECRET ?? "test-secret-test-secret-test-secret-1234" },
      });
      const clean = run();
      expect([clean.status, clean.stdout]).toEqual([0, expect.stringContaining("No hay datos huérfanos")]);
      await plantOrphans();
      const dirty = run();
      expect(dirty.status).toBe(1);
      expect(dirty.stdout).toContain("huérfanos");
      expect(dirty.stdout).toContain("order_items.orderId");
      await db.execute(sql`DELETE FROM order_items WHERE orderId = ${GHOST}`);
      await db.execute(sql`UPDATE orders SET courierId = NULL WHERE courierId = ${GHOST}`);
      await db.execute(sql`DELETE FROM orders WHERE customerId = ${GHOST}`);
      expect(run().status).toBe(0);
    }, 60_000);
  });
});
