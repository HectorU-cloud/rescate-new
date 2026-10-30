/**
 * Pruebas de integración (MySQL real): centro de notificaciones dentro de la app.
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("centro de notificaciones (MySQL real)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let appRouter: (typeof import("./router"))["appRouter"];
  let push: typeof import("./lib/push-notifications");
  let lib: typeof import("./lib/notifications");

  const tag = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let seq = 0;
  const users: number[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON; // sin push configurado: el historial debe guardarse igual
    db = (await import("./queries/connection")).getDb();
    S = await import("@db/schema");
    appRouter = (await import("./router")).appRouter;
    push = await import("./lib/push-notifications");
    lib = await import("./lib/notifications");
  });

  afterAll(async () => {
    if (!db || users.length === 0) return;
    await db.delete(S.notifications).where(inArray(S.notifications.userId, users));
    await db.delete(S.users).where(inArray(S.users.id, users));
  });

  type User = Awaited<ReturnType<typeof mkUser>>;
  async function mkUser() {
    const [{ id }] = await db.insert(S.users).values({ unionId: `${tag}-u${seq++}`, name: `${tag} user`, appRole: "customer" }).$returningId();
    users.push(id);
    return (await db.select().from(S.users).where(eq(S.users.id, id)))[0];
  }
  const callerFor = (user: User) => appRouter.createCaller({ req: new Request("http://localhost/test"), resHeaders: new Headers(), user });

  it("cada push queda en el historial aunque Firebase no esté configurado", async () => {
    const a = await mkUser();
    const b = await mkUser();
    await push.sendPushToUser(a.id, { title: "Pedido recibido 🧾", body: "Recibimos tu pedido", orderId: 77 });
    const mine = await callerFor(a).notifications.list();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: "Pedido recibido 🧾", url: "/pedido/77", readAt: null });
    expect(await callerFor(b).notifications.list()).toHaveLength(0); // cada quien ve solo lo suyo
    expect((await callerFor(a).notifications.unreadCount()).count).toBe(1);
  });

  it("un usuario inexistente no rompe el envío", async () => {
    await expect(push.sendPushToUser(2_000_000_000, { title: "x", body: "y" })).resolves.toBeTruthy();
  });

  it("los avisos con la misma etiqueta sin leer se agrupan en uno", async () => {
    const u = await mkUser();
    for (const body of ["hola", "¿vienes?", "estoy afuera"]) await push.sendPushToUser(u.id, { title: "Mensaje nuevo", body, tag: `chat-${tag}` });
    let list = await callerFor(u).notifications.list();
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("estoy afuera");
    await callerFor(u).notifications.markRead({ id: list[0].id });
    await push.sendPushToUser(u.id, { title: "Mensaje nuevo", body: "gracias", tag: `chat-${tag}` });
    list = await callerFor(u).notifications.list();
    expect(list).toHaveLength(2); // el leído se conserva; el nuevo es otra fila
  });

  it("marcar como leído solo funciona sobre los avisos propios", async () => {
    const a = await mkUser();
    const b = await mkUser();
    await push.sendPushToUser(a.id, { title: "Solo mío", body: "privado" });
    const [row] = await callerFor(a).notifications.list();
    await callerFor(b).notifications.markRead({ id: row.id }); // no debe afectar a `a`
    expect((await callerFor(a).notifications.unreadCount()).count).toBe(1);
    await callerFor(a).notifications.markRead({ id: row.id });
    expect((await callerFor(a).notifications.unreadCount()).count).toBe(0);
  });

  it("marcar todas como leídas", async () => {
    const u = await mkUser();
    for (let i = 0; i < 3; i++) await push.sendPushToUser(u.id, { title: `Aviso ${i}`, body: "x" });
    expect((await callerFor(u).notifications.unreadCount()).count).toBe(3);
    await callerFor(u).notifications.markAllRead();
    expect((await callerFor(u).notifications.unreadCount()).count).toBe(0);
  });

  it("la limpieza borra los leídos antiguos y deja los recientes y los sin leer", async () => {
    const u = await mkUser();
    const old = new Date(Date.now() - 40 * 24 * 3600_000);
    await db.insert(S.notifications).values([
      { userId: u.id, title: "leído viejo", body: "x", readAt: old, createdAt: old },
      { userId: u.id, title: "sin leer reciente", body: "x" },
    ]);
    await lib.pruneNotifications();
    const titles = (await callerFor(u).notifications.list()).map((n) => n.title);
    expect(titles).toEqual(["sin leer reciente"]);
  });
});
