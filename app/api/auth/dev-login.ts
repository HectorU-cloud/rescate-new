import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { Session } from "@contracts/constants";
import { env } from "../lib/env";
import { getSessionCookieOptions } from "../lib/cookies";
import { signSessionToken } from "./session";
import { findUserByUnionId, upsertUser } from "../queries/users";

/**
 * Login falso para trabajar en local sin credenciales de Google.
 * Solo se registra si DEV_LOGIN=true y NODE_ENV != production.
 * Uso: /api/dev-login            -> usuario "dev-user"
 *      /api/dev-login?as=cliente -> usuario "dev-cliente" (para probar otros roles)
 */
export function devLoginHandler() {
  return async (c: Context) => {
    const who = (c.req.query("as") ?? "user").replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || "user";
    const unionId = `dev-${who}`;
    await upsertUser({
      unionId,
      name: `Dev ${who}`,
      email: `${unionId}@local.dev`,
      lastSignInAt: new Date(),
    });
    const user = await findUserByUnionId(unionId);
    const token = await signSessionToken({ unionId, sv: user?.sessionVersion ?? 0 });
    setCookie(c, Session.cookieName, token, {
      ...getSessionCookieOptions(c.req.raw.headers),
      maxAge: Session.maxAgeMs / 1000,
    });
    return c.redirect("/", 302);
  };
}
