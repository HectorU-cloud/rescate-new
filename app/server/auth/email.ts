import type { Context } from "hono";
import { and, eq, gt, sql } from "drizzle-orm";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { setCookie } from "hono/cookie";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { env } from "../lib/env";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "../lib/cookies";
import { signSessionToken } from "./session";
import { findUserByEmail } from "../queries/users";
import { clearBucket, consume } from "../lib/rate-limit";

const HOUR = 60 * 60 * 1000;
const QUARTER = 15 * 60 * 1000;

// Mismas respuestas exista o no el correo: no se puede averiguar quién tiene cuenta.
const REGISTER_MESSAGE =
  "Si el correo es válido, te enviamos un mensaje para continuar. Revisa tu bandeja de entrada y la carpeta de spam. Si no llega en unos minutos, puedes pedir que lo reenviemos.";
const RESEND_MESSAGE =
  "Si el correo corresponde a una cuenta pendiente de verificación, te enviamos un nuevo enlace. Revisa también la carpeta de spam.";
const FORGOT_MESSAGE = "Si el correo corresponde a una cuenta, recibirás instrucciones para continuar.";
const TOO_MANY = "Demasiados intentos. Espera un momento y vuelve a intentarlo.";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
// scrypt asíncrono: no bloquea el servidor mientras calcula (la versión Sync paraliza todo ~80 ms por intento)
const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await scryptAsync(password, salt, 64)).toString("hex")}`;
}
async function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const actual = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
// Para gastar el mismo tiempo cuando el correo no existe (si no, la demora delata qué correos tienen cuenta)
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= passwordHash(randomBytes(12).toString("hex")));

async function sendEmail(to: string, subject: string, html: string) {
  if (!env.resendApiKey) throw new Error("RESEND_API_KEY no está configurado");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.authEmailFrom, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`No se pudo enviar el correo (${response.status})`);
}
/** Envío que nunca interrumpe la respuesta: si el correo falla se registra y el usuario puede pedir un reenvío. */
async function safeSend(to: string, subject: string, html: string) {
  try { await sendEmail(to, subject, html); return true; }
  catch (e) { console.error("[auth] no se pudo enviar el correo", e instanceof Error ? e.message : e); return false; }
}
// Tope por destinatario: evita usar la app para llenar de correos la bandeja de otra persona
const mailAllowed = (email: string) => consume(`mail:${email}`, HOUR, 5).allowed;

function appBase(c: Context) { return (env.appUrl || new URL(c.req.url).origin).replace(/\/$/, ""); }
const plain = (text: string) => text.replace(/[&<>"']/g, "");

async function issueToken(userId: number, purpose: "verify_email" | "reset_password") {
  const token = randomBytes(32).toString("base64url");
  const db = getDb();
  // Un solo enlace vigente por propósito: pedir uno nuevo anula el anterior
  await db.delete(schema.authTokens).where(and(eq(schema.authTokens.userId, userId), eq(schema.authTokens.purpose, purpose)));
  await db.insert(schema.authTokens).values({ userId, tokenHash: hashToken(token), purpose, expiresAt: new Date(Date.now() + HOUR) });
  return token;
}
function validEmail(email: unknown): email is string { return typeof email === "string" && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validPassword(password: unknown): password is string { return typeof password === "string" && password.length >= 10 && password.length <= 128; }
const normEmail = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
function isDuplicateKey(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "ER_DUP_ENTRY" || err?.cause?.code === "ER_DUP_ENTRY";
}
/** Cuenta creada con correo y contraseña que nunca confirmó el correo. */
const isUnverifiedEmailAccount = (u: { unionId: string; emailVerifiedAt: Date | null }) =>
  u.unionId.startsWith("email:") && !u.emailVerifiedAt;

function verificationEmail(base: string, name: string, token: string) {
  const link = `${base}/api/auth/email/verify?token=${encodeURIComponent(token)}`;
  return `<p>Hola ${plain(name)},</p><p>Confirma tu correo para activar tu cuenta de Al Rescate.</p><p><a href="${link}">Verificar mi correo</a></p><p>El enlace vence en una hora.</p>`;
}

export async function emailRegister(c: Context) {
  try {
    const body = await c.req.json() as { name?: unknown; email?: unknown; password?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 255) : "";
    const email = normEmail(body.email);
    if (name.length < 2 || !validEmail(email) || !validPassword(body.password)) return c.json({ error: "Ingresa nombre, correo válido y una contraseña de al menos 10 caracteres." }, 400);

    const hash = await passwordHash(body.password); // mismo costo exista o no el correo
    const db = getDb();
    const base = appBase(c);
    let user = await findUserByEmail(email);
    let created = false;
    if (!user) {
      try {
        await db.insert(schema.users).values({ unionId: `email:${email}`, name, email, role: "user", passwordHash: hash, emailVerifiedAt: null, lastSignInAt: new Date() });
        created = true;
      } catch (e) { if (!isDuplicateKey(e)) throw e; } // otro registro simultáneo ganó: seguimos con esa cuenta
      user = await findUserByEmail(email);
    }
    if (!user) return c.json({ error: "No se pudo completar el registro. Inténtalo de nuevo." }, 500);

    if (isUnverifiedEmailAccount(user)) {
      // Si alguien registró este correo antes sin verificarlo, manda la persona que se registra ahora:
      // se reemplaza la contraseña, así quien solo conocía el correo no se queda con la cuenta.
      if (!created) await db.update(schema.users).set({ name, passwordHash: hash }).where(eq(schema.users.id, user.id));
      if (mailAllowed(email)) {
        const token = await issueToken(user.id, "verify_email");
        await safeSend(email, "Verifica tu correo — Al Rescate", verificationEmail(base, name, token));
      }
    } else if (mailAllowed(email)) {
      // Ya tiene cuenta (verificada o con Google): se avisa por correo, sin revelarlo en la respuesta
      await safeSend(email, "Ya tienes una cuenta — Al Rescate", `<p>Hola,</p><p>Alguien intentó crear una cuenta de Al Rescate con este correo, pero ya existe una.</p><p>Si fuiste tú, <a href="${base}/login">inicia sesión</a> o usa «¿Olvidaste tu contraseña?». Si no fuiste tú, ignora este mensaje.</p>`);
    }
    return c.json({ success: true, message: REGISTER_MESSAGE }, 201);
  } catch (e) { console.error("[auth] register failed", e); return c.json({ error: "No se pudo completar el registro. Inténtalo de nuevo." }, 500); }
}

/** Pide un enlace nuevo de verificación (el anterior queda anulado). Responde igual exista o no la cuenta. */
export async function resendVerification(c: Context) {
  try {
    const body = await c.req.json() as { email?: unknown };
    const email = normEmail(body.email);
    if (!validEmail(email)) return c.json({ error: "Ingresa un correo válido." }, 400);
    const allowed = consume(`resend:${email}`, HOUR, 3).allowed && mailAllowed(email);
    const user = allowed ? await findUserByEmail(email) : undefined;
    if (user && isUnverifiedEmailAccount(user)) {
      const token = await issueToken(user.id, "verify_email");
      await safeSend(email, "Verifica tu correo — Al Rescate", verificationEmail(appBase(c), user.name ?? "", token));
    }
    return c.json({ success: true, message: RESEND_MESSAGE });
  } catch (e) { console.error("[auth] resend failed", e); return c.json({ error: "No se pudo reenviar el correo. Inténtalo más tarde." }, 500); }
}

export async function emailLogin(c: Context) {
  try {
    const body = await c.req.json() as { email?: unknown; password?: unknown };
    const email = normEmail(body.email);
    if (!validEmail(email) || typeof body.password !== "string" || body.password.length > 128) return c.json({ error: "Correo o contraseña incorrectos." }, 400);
    // Límite por correo (además del de IP): frena adivinanzas repartidas entre muchas IPs
    const limit = consume(`login:${email}`, QUARTER, 10);
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfterSec));
      return c.json({ error: TOO_MANY }, 429);
    }
    const db = getDb();
    const user = await findUserByEmail(email);
    let passwordOk = false;
    if (user?.passwordHash) passwordOk = await verifyPassword(body.password, user.passwordHash);
    else await verifyPassword(body.password, await getDummyHash()); // gasta el mismo tiempo
    if (!user || !passwordOk) return c.json({ error: "Correo o contraseña incorrectos." }, 401);
    if (!user.emailVerifiedAt) return c.json({ error: "Verifica tu correo desde el enlace que te enviamos antes de iniciar sesión.", code: "email_not_verified" }, 403);
    clearBucket(`login:${email}`);
    await db.update(schema.users).set({ lastSignInAt: new Date() }).where(eq(schema.users.id, user.id));
    const token = await signSessionToken({ unionId: user.unionId, sv: user.sessionVersion });
    setCookie(c, Session.cookieName, token, { ...getSessionCookieOptions(c.req.raw.headers), maxAge: Session.maxAgeMs / 1000 });
    return c.json({ success: true });
  } catch (e) { console.error("[auth] email login failed", e); return c.json({ error: "No se pudo iniciar sesión. Inténtalo de nuevo." }, 500); }
}

export async function verifyEmail(c: Context) {
  const token = c.req.query("token") || "";
  const db = getDb();
  const rows = await db.select().from(schema.authTokens).where(and(eq(schema.authTokens.tokenHash, hashToken(token)), eq(schema.authTokens.purpose, "verify_email"), gt(schema.authTokens.expiresAt, new Date()))).limit(1);
  const record = rows[0];
  if (!record) return c.redirect("/login?error=verification", 302);
  // Se consume el enlace de forma atómica: dos clics simultáneos no pueden usarlo a la vez
  const [consumed] = await db.delete(schema.authTokens).where(eq(schema.authTokens.id, record.id));
  if (consumed.affectedRows === 0) return c.redirect("/login?error=verification", 302);
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, record.userId));
  await db.delete(schema.authTokens).where(and(eq(schema.authTokens.userId, record.userId), eq(schema.authTokens.purpose, "verify_email")));
  return c.redirect("/login?verified=1", 302);
}

export async function requestPasswordReset(c: Context) {
  try {
    const body = await c.req.json() as { email?: unknown };
    const email = normEmail(body.email);
    if (validEmail(email) && mailAllowed(email)) {
      const user = await findUserByEmail(email);
      // También sirve para cuentas sin verificar: usar el enlace demuestra que el correo es suyo
      if (user?.passwordHash) {
        const token = await issueToken(user.id, "reset_password");
        const link = `${appBase(c)}/login?mode=reset&token=${encodeURIComponent(token)}`;
        await safeSend(email, "Recupera tu contraseña — Al Rescate", `<p>Solicitaste cambiar tu contraseña.</p><p><a href="${link}">Crear una contraseña nueva</a></p><p>El enlace vence en una hora. Si no lo solicitaste, ignora este correo.</p>`);
      }
    }
    return c.json({ success: true, message: FORGOT_MESSAGE });
  } catch (e) { console.error("[auth] reset request failed", e); return c.json({ error: "No se pudo procesar la solicitud. Inténtalo más tarde." }, 500); }
}

export async function resetPassword(c: Context) {
  try {
    const body = await c.req.json() as { token?: unknown; password?: unknown };
    if (typeof body.token !== "string" || !validPassword(body.password)) return c.json({ error: "El enlace no es válido o la contraseña no cumple los requisitos." }, 400);
    const db = getDb();
    const rows = await db.select().from(schema.authTokens).where(and(eq(schema.authTokens.tokenHash, hashToken(body.token)), eq(schema.authTokens.purpose, "reset_password"), gt(schema.authTokens.expiresAt, new Date()))).limit(1);
    const record = rows[0];
    if (!record) return c.json({ error: "El enlace expiró o ya fue utilizado. Solicita uno nuevo." }, 400);
    const newHash = await passwordHash(body.password);
    // El enlace sirve una sola vez, aunque lleguen dos usos simultáneos
    const [consumed] = await db.delete(schema.authTokens).where(eq(schema.authTokens.id, record.id));
    if (consumed.affectedRows === 0) return c.json({ error: "El enlace expiró o ya fue utilizado. Solicita uno nuevo." }, 400);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, record.userId)).limit(1);
    await db.update(schema.users).set({
      passwordHash: newHash,
      emailVerifiedAt: user?.emailVerifiedAt ?? new Date(), // el enlace llegó a su correo: queda verificado
      sessionVersion: sql`${schema.users.sessionVersion} + 1`, // cierra todas las sesiones abiertas con la clave anterior
    }).where(eq(schema.users.id, record.userId));
    await db.delete(schema.authTokens).where(eq(schema.authTokens.userId, record.userId));
    return c.json({ success: true, message: "Contraseña actualizada. Ya puedes iniciar sesión." });
  } catch (e) { console.error("[auth] reset failed", e); return c.json({ error: "No se pudo cambiar la contraseña." }, 500); }
}
