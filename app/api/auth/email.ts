import type { Context } from "hono";
import { and, eq, gt } from "drizzle-orm";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { setCookie } from "hono/cookie";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { env } from "../lib/env";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "../lib/cookies";
import { signSessionToken } from "./session";
import { upsertUser } from "../queries/users";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function sendEmail(to: string, subject: string, html: string) {
  if (!env.resendApiKey) throw new Error("RESEND_API_KEY no está configurado");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.authEmailFrom, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`No se pudo enviar el correo (${response.status})`);
}
function appBase(c: Context) { return (env.appUrl || new URL(c.req.url).origin).replace(/\/$/, ""); }
async function issueToken(userId: number, purpose: "verify_email" | "reset_password") {
  const token = randomBytes(32).toString("base64url");
  const db = getDb();
  await db.insert(schema.authTokens).values({ userId, tokenHash: hashToken(token), purpose, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  return token;
}
function validEmail(email: unknown): email is string { return typeof email === "string" && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validPassword(password: unknown): password is string { return typeof password === "string" && password.length >= 10 && password.length <= 128; }

export async function emailRegister(c: Context) {
  try {
    const body = await c.req.json() as { name?: unknown; email?: unknown; password?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 255) : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (name.length < 2 || !validEmail(email) || !validPassword(body.password)) return c.json({ error: "Ingresa nombre, correo válido y una contraseña de al menos 10 caracteres." }, 400);
    const db = getDb();
    const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing.length) return c.json({ error: "No se pudo crear la cuenta con esos datos. Si ya tienes cuenta, inicia sesión o recupera tu contraseña." }, 409);
    const unionId = `email:${email}`;
    await upsertUser({ unionId, name, email, role: "user", passwordHash: passwordHash(body.password), emailVerifiedAt: null, lastSignInAt: new Date() });
    const rows = await db.select().from(schema.users).where(eq(schema.users.unionId, unionId)).limit(1);
    const user = rows[0];
    if (!user) return c.json({ error: "No se pudo crear la cuenta." }, 500);
    const token = await issueToken(user.id, "verify_email");
    const link = `${appBase(c)}/api/auth/email/verify?token=${encodeURIComponent(token)}`;
    await sendEmail(email, "Verifica tu correo — Al Rescate", `<p>Hola ${name.replace(/[&<>"']/g, "")},</p><p>Confirma tu correo para activar tu cuenta de Al Rescate.</p><p><a href="${link}">Verificar mi correo</a></p><p>El enlace vence en una hora.</p>`);
    return c.json({ success: true, message: "Cuenta creada. Revisa tu correo para verificar la dirección antes de iniciar sesión." }, 201);
  } catch (e) { console.error("[auth] register failed", e); return c.json({ error: "No se pudo completar el registro. Revisa la configuración de correo e inténtalo de nuevo." }, 500); }
}

export async function emailLogin(c: Context) {
  try {
    const body = await c.req.json() as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!validEmail(email) || typeof body.password !== "string") return c.json({ error: "Correo o contraseña incorrectos." }, 400);
    const db = getDb();
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    const user = rows[0];
    if (!user?.passwordHash || !verifyPassword(body.password, user.passwordHash)) return c.json({ error: "Correo o contraseña incorrectos." }, 401);
    if (!user.emailVerifiedAt) return c.json({ error: "Verifica tu correo desde el enlace que te enviamos antes de iniciar sesión." }, 403);
    await db.update(schema.users).set({ lastSignInAt: new Date() }).where(eq(schema.users.id, user.id));
    const token = await signSessionToken({ unionId: user.unionId });
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
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, record.userId));
  await db.delete(schema.authTokens).where(eq(schema.authTokens.id, record.id));
  return c.redirect("/login?verified=1", 302);
}

export async function requestPasswordReset(c: Context) {
  try {
    const body = await c.req.json() as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    // Same response regardless of whether the address exists.
    if (validEmail(email)) {
      const db = getDb();
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      const user = rows[0];
      if (user?.passwordHash && user.emailVerifiedAt) {
        const token = await issueToken(user.id, "reset_password");
        const link = `${appBase(c)}/login?mode=reset&token=${encodeURIComponent(token)}`;
        await sendEmail(email, "Recupera tu contraseña — Al Rescate", `<p>Solicitaste cambiar tu contraseña.</p><p><a href="${link}">Crear una contraseña nueva</a></p><p>El enlace vence en una hora. Si no lo solicitaste, ignora este correo.</p>`);
      }
    }
    return c.json({ success: true, message: "Si el correo corresponde a una cuenta, recibirás instrucciones para continuar." });
  } catch (e) { console.error("[auth] reset request failed", e); return c.json({ error: "No se pudo enviar el correo de recuperación. Inténtalo más tarde." }, 500); }
}

export async function resetPassword(c: Context) {
  try {
    const body = await c.req.json() as { token?: unknown; password?: unknown };
    if (typeof body.token !== "string" || !validPassword(body.password)) return c.json({ error: "El enlace no es válido o la contraseña no cumple los requisitos." }, 400);
    const db = getDb();
    const rows = await db.select().from(schema.authTokens).where(and(eq(schema.authTokens.tokenHash, hashToken(body.token),), eq(schema.authTokens.purpose, "reset_password"), gt(schema.authTokens.expiresAt, new Date()))).limit(1);
    const record = rows[0];
    if (!record) return c.json({ error: "El enlace expiró o ya fue utilizado. Solicita uno nuevo." }, 400);
    await db.update(schema.users).set({ passwordHash: passwordHash(body.password) }).where(eq(schema.users.id, record.userId));
    await db.delete(schema.authTokens).where(and(eq(schema.authTokens.userId, record.userId), eq(schema.authTokens.purpose, "reset_password")));
    return c.json({ success: true, message: "Contraseña actualizada. Ya puedes iniciar sesión." });
  } catch (e) { console.error("[auth] reset failed", e); return c.json({ error: "No se pudo cambiar la contraseña." }, 500); }
}
