/**
 * Pruebas de integración (MySQL real) de las cuentas con correo y contraseña:
 * registro sin revelar qué correos existen, reenviar verificación, límites de intentos,
 * recuperación de contraseña, cierre de sesiones y acceso con Google sin cuentas duplicadas.
 *
 * Corren solo si defines TEST_DATABASE_URL (ver flows.integration.test.ts). No envían correos
 * reales: `fetch` hacia Resend se reemplaza por un registro en memoria.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";

const TEST_URL = process.env.TEST_DATABASE_URL;
const dbName = TEST_URL ? new URL(TEST_URL).pathname.replace(/^\//, "") : "";
const enabled = !!TEST_URL && /test/i.test(dbName);

describe.skipIf(!enabled)("cuentas con correo y contraseña (MySQL real)", () => {
  let db: ReturnType<(typeof import("./queries/connection"))["getDb"]>;
  let S: typeof import("@db/schema");
  let app: Hono<{ Bindings: HttpBindings }>;
  let authenticateRequest: (typeof import("./auth/authenticate"))["authenticateRequest"];
  let signSessionToken: (typeof import("./auth/session"))["signSessionToken"];
  let linkGoogleUser: (typeof import("./auth/google-link"))["linkGoogleUser"];
  let appRouter: (typeof import("./router"))["appRouter"];

  const tag = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let seq = 0;
  const newEmail = () => `${tag}-${seq++}@test.dev`;
  const PASS = "ClaveSegura-123";

  const sent: Array<{ to: string; subject: string; html: string }> = [];
  let failEmails = false;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-1234";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.AUTH_EMAIL_FROM = "Test <test@example.test>";
    process.env.APP_URL = "";
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).includes("api.resend.com")) throw new Error(`fetch inesperado: ${String(url)}`);
      if (failEmails) return new Response("boom", { status: 500 });
      const body = JSON.parse(String(init?.body));
      sent.push({ to: body.to[0], subject: body.subject, html: body.html });
      return new Response("{}", { status: 200 });
    }));
    db = (await import("./queries/connection")).getDb();
    S = await import("@db/schema");
    ({ authenticateRequest } = await import("./auth/authenticate"));
    ({ signSessionToken } = await import("./auth/session"));
    ({ linkGoogleUser } = await import("./auth/google-link"));
    ({ appRouter } = await import("./router"));
    const { registerAuthRoutes } = await import("./auth/routes");
    app = new Hono<{ Bindings: HttpBindings }>();
    registerAuthRoutes(app);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (!db) return;
    const rows = await db.select({ id: S.users.id }).from(S.users).where(like(S.users.email, `${tag}-%`));
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await db.delete(S.authTokens).where(inArray(S.authTokens.userId, ids));
      await db.delete(S.pushTokens).where(inArray(S.pushTokens.userId, ids));
      await db.delete(S.users).where(inArray(S.users.id, ids));
    }
  });

  // ------------------------------------------------------------------ ayudantes
  let ipSeq = 0;
  const nextIp = () => `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  const call = (method: string, path: string, body?: unknown, ip = nextIp()) =>
    app.request(
      `http://localhost:3000${path}`,
      { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
      { incoming: { socket: { remoteAddress: ip } } } as unknown as HttpBindings,
    );
  const register = (email: string, password = PASS, name = "Usuario Prueba") => call("POST", "/api/auth/email/register", { name, email, password });
  const resend = (email: string) => call("POST", "/api/auth/email/resend", { email });
  const login = (email: string, password = PASS, ip?: string) => call("POST", "/api/auth/email/login", { email, password }, ip);
  const forgot = (email: string) => call("POST", "/api/auth/email/forgot", { email });
  const mailsTo = (email: string) => sent.filter((m) => m.to === email);
  const lastMail = (email: string) => mailsTo(email).at(-1)!;
  const tokenIn = (mail: { html: string }) => decodeURIComponent(/token=([^"&]+)/.exec(mail.html)![1]);
  const verify = (token: string) => call("GET", `/api/auth/email/verify?token=${encodeURIComponent(token)}`);
  const getUser = async (email: string) => (await db.select().from(S.users).where(eq(S.users.email, email)))[0];
  const cookieOf = (res: Response) => /alrescate_sid=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";
  async function verifiedAccount(password = PASS) {
    const email = newEmail();
    await register(email, password);
    await verify(tokenIn(lastMail(email)));
    return email;
  }
  async function reject(promise: Promise<unknown>) {
    try { await promise; } catch (e) { return e as { code?: string; message?: string }; }
    throw new Error("se esperaba un error");
  }

  // ------------------------------------------------------------------ registro
  describe("registro", () => {
    it("crea la cuenta sin verificar y envía un correo con el enlace de verificación", async () => {
      const email = newEmail();
      const res = await register(email);
      expect(res.status).toBe(201);
      const user = await getUser(email);
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.role).toBe("user");
      expect(mailsTo(email)).toHaveLength(1);
      expect(lastMail(email).subject).toMatch(/Verifica/);
      expect(lastMail(email).html).toContain("/api/auth/email/verify?token=");
    });

    it("no se puede iniciar sesión hasta verificar; con el enlace ya sí", async () => {
      const email = newEmail();
      await register(email);
      const before = await login(email);
      expect(before.status).toBe(403);
      expect(((await before.json()) as { code: string }).code).toBe("email_not_verified");
      const v = await verify(tokenIn(lastMail(email)));
      expect(v.headers.get("location")).toBe("/login?verified=1");
      const after = await login(email);
      expect(after.status).toBe(200);
      expect(cookieOf(after)).toMatch(/^alrescate_sid=/);
    });

    it("la respuesta es idéntica exista o no el correo: no se puede averiguar quién tiene cuenta", async () => {
      const fresh = await register(newEmail());
      const verified = await verifiedAccount();
      const again = await register(verified, "OtraClave-456");
      const googleEmail = newEmail();
      await db.insert(S.users).values({ unionId: `google:${tag}-${seq++}`, email: googleEmail, name: "G", emailVerifiedAt: new Date() });
      const withGoogle = await register(googleEmail);
      const bodies = await Promise.all([fresh, again, withGoogle].map(async (r) => [r.status, await r.text()]));
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
      expect(bodies[0][0]).toBe(201);
    });

    it("registrar un correo con cuenta verificada NO cambia su contraseña y avisa sin enlace de verificación", async () => {
      const email = await verifiedAccount();
      const mailsBefore = mailsTo(email).length;
      await register(email, "ClaveDelAtacante-9");
      expect((await login(email, PASS)).status).toBe(200); // la clave original sigue valiendo
      expect((await login(email, "ClaveDelAtacante-9")).status).toBe(401);
      const notice = mailsTo(email).slice(mailsBefore);
      expect(notice).toHaveLength(1);
      expect(notice[0].subject).toMatch(/Ya tienes una cuenta/);
      expect(notice[0].html).not.toContain("verify?token");
    });

    it("registrar un correo que ya entró con Google no toca esa cuenta", async () => {
      const email = newEmail();
      const unionId = `google:${tag}-${seq++}`;
      await db.insert(S.users).values({ unionId, email, name: "Google User", emailVerifiedAt: new Date() });
      await register(email);
      const user = await getUser(email);
      expect([user.unionId, user.passwordHash]).toEqual([unionId, null]);
      expect(lastMail(email).subject).toMatch(/Ya tienes una cuenta/);
    });

    it("re-registrar un correo sin verificar reemplaza la contraseña y anula el enlace anterior", async () => {
      const email = newEmail();
      await register(email, "ClaveVieja-1234");
      const oldToken = tokenIn(lastMail(email));
      await register(email, "ClaveNueva-5678");
      const newToken = tokenIn(lastMail(email));
      expect(newToken).not.toBe(oldToken);
      expect((await verify(oldToken)).headers.get("location")).toBe("/login?error=verification");
      expect((await verify(newToken)).headers.get("location")).toBe("/login?verified=1");
      expect((await login(email, "ClaveNueva-5678")).status).toBe(200);
      expect((await login(email, "ClaveVieja-1234")).status).toBe(401);
    });

    it("si el correo no se puede enviar, igual se crea la cuenta, la respuesta es la misma y luego se puede reenviar", async () => {
      const ok = await register(newEmail());
      const okBody = await ok.text();
      const email = newEmail();
      failEmails = true;
      let res: Response;
      try { res = await register(email); } finally { failEmails = false; }
      expect([res.status, await res.text()]).toEqual([201, okBody]);
      expect(await getUser(email)).toBeDefined();
      expect(mailsTo(email)).toHaveLength(0);
      await resend(email);
      expect(mailsTo(email)).toHaveLength(1);
      await verify(tokenIn(lastMail(email)));
      expect((await login(email)).status).toBe(200);
    });

    it("dos registros simultáneos del mismo correo dejan una sola cuenta", async () => {
      const email = newEmail();
      const results = await Promise.all([register(email), register(email, "OtraClave-4567")]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(await db.select().from(S.users).where(eq(S.users.email, email))).toHaveLength(1);
    });

    it("valida los datos (400) sin revelar nada más", async () => {
      expect((await register("no-es-correo")).status).toBe(400);
      expect((await register(newEmail(), "corta")).status).toBe(400);
      expect((await register(newEmail(), PASS, "A")).status).toBe(400);
    });
  });

  // ------------------------------------------------------------------ reenviar verificación
  describe("reenviar verificación", () => {
    it("correo desconocido: misma respuesta y no se envía nada", async () => {
      const real = newEmail(); await register(real);
      const a = await resend(real); const unknown = newEmail(); const b = await resend(unknown);
      expect([b.status, await b.text()]).toEqual([a.status, await a.text()]);
      expect(mailsTo(unknown)).toHaveLength(0);
    });
    it("cuenta sin verificar: llega un enlace nuevo y el anterior queda anulado", async () => {
      const email = newEmail(); await register(email);
      const oldToken = tokenIn(lastMail(email));
      await resend(email);
      expect(mailsTo(email)).toHaveLength(2);
      const newToken = tokenIn(lastMail(email));
      expect((await verify(oldToken)).headers.get("location")).toBe("/login?error=verification");
      expect((await verify(newToken)).headers.get("location")).toBe("/login?verified=1");
    });
    it("cuenta ya verificada: responde igual y no manda enlace de verificación", async () => {
      const email = await verifiedAccount(); const before = mailsTo(email).length;
      const res = await resend(email);
      expect(res.status).toBe(200);
      expect(mailsTo(email)).toHaveLength(before);
    });
    it("máximo 3 reenvíos por hora por correo, sin delatar el límite", async () => {
      const email = newEmail(); await register(email);
      const bodies = new Set<string>();
      for (let i = 0; i < 6; i++) { const r = await resend(email); expect(r.status).toBe(200); bodies.add(await r.text()); }
      expect(bodies.size).toBe(1);
      expect(mailsTo(email)).toHaveLength(4); // 1 del registro + 3 reenvíos
    });
    it("un correo con formato inválido da 400", async () => {
      expect((await resend("sin-arroba")).status).toBe(400);
    });
  });

  // ------------------------------------------------------------------ inicio de sesión
  describe("inicio de sesión", () => {
    it("correo inexistente y contraseña incorrecta dan exactamente la misma respuesta", async () => {
      const email = await verifiedAccount();
      const wrongPass = await login(email, "ClaveIncorrecta-1");
      const unknown = await login(newEmail());
      expect([wrongPass.status, await wrongPass.text()]).toEqual([unknown.status, await unknown.text()]);
      expect(wrongPass.status).toBe(401);
    });
    it("límite por correo: tras 10 intentos fallidos desde IPs distintas se bloquea incluso la clave correcta", async () => {
      const email = await verifiedAccount();
      for (let i = 0; i < 10; i++) expect((await login(email, `mal-${i}-clave-larga`)).status).toBe(401);
      const blocked = await login(email, PASS);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBeTruthy();
      expect((await login(await verifiedAccount(), PASS)).status).toBe(200); // otra cuenta no se afecta
    });
    it("un inicio de sesión correcto reinicia el contador del correo", async () => {
      const email = await verifiedAccount();
      for (let i = 0; i < 8; i++) await login(email, `mal-${i}-clave-larga`);
      expect((await login(email, PASS)).status).toBe(200);
      for (let i = 0; i < 8; i++) expect((await login(email, `mal-${i}-clave-larga`)).status).toBe(401);
    });
    it("el límite por IP sigue funcionando y no se evade cambiando X-Forwarded-For", async () => {
      const ip = "172.31.5.5";
      const statuses: number[] = [];
      for (let i = 0; i < 13; i++) {
        const res = await app.request("http://localhost:3000/api/auth/email/login", {
          method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `8.8.8.${i}` },
          body: JSON.stringify({ email: newEmail(), password: "cualquier-clave-1" }),
        }, { incoming: { socket: { remoteAddress: ip } } } as unknown as HttpBindings);
        statuses.push(res.status);
      }
      expect(statuses.filter((s) => s === 429).length).toBe(3); // los intentos 11, 12 y 13
    });
  });

  // ------------------------------------------------------------------ recuperación y sesiones
  describe("recuperar contraseña y sesiones", () => {
    it("correo inexistente: misma respuesta y no se envía nada", async () => {
      const real = await verifiedAccount();
      const a = await forgot(real); const unknown = newEmail(); const b = await forgot(unknown);
      expect([b.status, await b.text()]).toEqual([a.status, await a.text()]);
      expect(mailsTo(unknown)).toHaveLength(0);
    });
    it("una cuenta sin verificar también puede recuperar: usar el enlace fija la clave y verifica el correo", async () => {
      const email = newEmail(); await register(email, "ClaveVieja-1234");
      await forgot(email);
      const mail = lastMail(email);
      expect(mail.subject).toMatch(/Recupera/);
      const reset = await call("POST", "/api/auth/email/reset", { token: tokenIn(mail), password: "ClaveRecuperada-77" });
      expect(reset.status).toBe(200);
      expect((await getUser(email)).emailVerifiedAt).not.toBeNull();
      expect((await login(email, "ClaveRecuperada-77")).status).toBe(200);
      expect((await login(email, "ClaveVieja-1234")).status).toBe(401);
    });
    it("el enlace sirve una sola vez, incluso con dos usos simultáneos", async () => {
      const email = await verifiedAccount(); await forgot(email);
      const token = tokenIn(lastMail(email));
      const results = await Promise.all([
        call("POST", "/api/auth/email/reset", { token, password: "ClaveUno-12345" }),
        call("POST", "/api/auth/email/reset", { token, password: "ClaveDos-12345" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });
    it("cambiar la contraseña cierra las sesiones anteriores", async () => {
      const email = await verifiedAccount();
      const old = cookieOf(await login(email));
      expect((await authenticateRequest(new Headers({ cookie: old }))).email).toBe(email);
      await forgot(email);
      await call("POST", "/api/auth/email/reset", { token: tokenIn(lastMail(email)), password: "ClaveNueva-98765" });
      expect((await reject(authenticateRequest(new Headers({ cookie: old })))).message).toMatch(/expired|re-login/i);
      const fresh = cookieOf(await login(email, "ClaveNueva-98765"));
      expect((await authenticateRequest(new Headers({ cookie: fresh }))).email).toBe(email);
    });
    it("las sesiones anteriores a este cambio (sin versión) siguen valiendo hasta que se cierren las sesiones", async () => {
      const email = await verifiedAccount();
      const user = await getUser(email);
      const legacy = `alrescate_sid=${await signSessionToken({ unionId: user.unionId })}`;
      expect((await authenticateRequest(new Headers({ cookie: legacy }))).id).toBe(user.id);
      await forgot(email);
      await call("POST", "/api/auth/email/reset", { token: tokenIn(lastMail(email)), password: "ClaveNueva-98765" });
      await reject(authenticateRequest(new Headers({ cookie: legacy })));
    });
    it("«cerrar sesión en todos los dispositivos» invalida las sesiones y borra los tokens de notificaciones", async () => {
      const email = await verifiedAccount();
      const cookie = cookieOf(await login(email));
      const user = await getUser(email);
      await db.insert(S.pushTokens).values({ userId: user.id, token: `${tag}-token-${"x".repeat(30)}` });
      const caller = appRouter.createCaller({ req: new Request("http://localhost/t"), resHeaders: new Headers(), user });
      await caller.auth.logoutEverywhere();
      await reject(authenticateRequest(new Headers({ cookie })));
      expect(await db.select().from(S.pushTokens).where(eq(S.pushTokens.userId, user.id))).toHaveLength(0);
      expect((await login(email)).status).toBe(200); // puede volver a entrar
    });
  });

  // ------------------------------------------------------------------ Google sin duplicados
  describe("acceso con Google", () => {
    const profile = (email: string, sub = `${tag}-sub-${seq++}`) => ({ sub, email, name: "Persona Google", picture: null });

    it("el primer ingreso crea la cuenta y la deja verificada", async () => {
      const email = newEmail(); const p = profile(email);
      const user = await linkGoogleUser(p);
      expect(user.unionId).toBe(`google:${p.sub}`);
      expect(user.emailVerifiedAt).not.toBeNull();
    });
    it("ingresos repetidos no duplican la cuenta", async () => {
      const email = newEmail(); const p = profile(email);
      const a = await linkGoogleUser(p); const b = await linkGoogleUser(p);
      expect(b.id).toBe(a.id);
      expect(await db.select().from(S.users).where(eq(S.users.email, email))).toHaveLength(1);
    });
    it("si el correo ya tiene cuenta verificada con contraseña, se usa esa misma cuenta y se conserva su contraseña", async () => {
      const email = await verifiedAccount();
      const before = await getUser(email);
      const user = await linkGoogleUser(profile(email));
      expect(user.id).toBe(before.id);
      expect(user.unionId).toBe(before.unionId);
      expect(user.passwordHash).toBe(before.passwordHash);
      expect((await login(email)).status).toBe(200);
      expect(await db.select().from(S.users).where(eq(S.users.email, email))).toHaveLength(1);
    });
    it("si la cuenta con contraseña NUNCA se verificó (pudo crearla un tercero), se borra esa contraseña y queda del dueño del correo", async () => {
      const email = newEmail();
      await register(email, "ClaveDelAtacante-1");
      const planted = await getUser(email);
      expect(planted.passwordHash).toBeTruthy();
      const user = await linkGoogleUser(profile(email));
      expect(user.id).toBe(planted.id);
      expect(user.passwordHash).toBeNull();
      expect(user.emailVerifiedAt).not.toBeNull();
      expect((await login(email, "ClaveDelAtacante-1")).status).toBe(401); // la clave sembrada ya no sirve
    });
  });

  it("el correo es único en la base de datos", async () => {
    const email = newEmail();
    await db.insert(S.users).values({ unionId: `u:${tag}-${seq++}`, email });
    const e = await reject(db.insert(S.users).values({ unionId: `u:${tag}-${seq++}`, email }));
    expect(JSON.stringify(e) + String((e as Error).message) + String((e as { cause?: unknown }).cause)).toMatch(/Duplicate|ER_DUP_ENTRY/i);
  });
});
