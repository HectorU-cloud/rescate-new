import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as jose from "jose";
import { nanoid } from "nanoid";
import { Paths, Session } from "@contracts/constants";
import { env } from "../lib/env";
import { getSessionCookieOptions } from "../lib/cookies";
import { signSessionToken } from "./session";
import { upsertUser } from "../queries/users";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = jose.createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

const STATE_COOKIE = "g_oauth_state";

function redirectUri(c: Context): string {
  const base = env.appUrl || new URL(c.req.url).origin;
  return `${base}${Paths.googleCallback}`;
}

function stateCookieOptions(c: Context) {
  // Lax: el regreso desde Google es una navegación de primer nivel (GET)
  return { ...getSessionCookieOptions(c.req.raw.headers), path: "/api/oauth" };
}

/** Paso 1: redirige al usuario a la pantalla de Google. */
export function googleLoginHandler() {
  return (c: Context) => {
    if (!env.googleClientId) {
      return c.json({ error: "GOOGLE_CLIENT_ID no está configurado" }, 500);
    }
    const state = nanoid(32);
    setCookie(c, STATE_COOKIE, state, {
      ...stateCookieOptions(c),
      maxAge: 10 * 60,
    });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", env.googleClientId);
    url.searchParams.set("redirect_uri", redirectUri(c));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    return c.redirect(url.toString(), 302);
  };
}

/** Paso 2: Google vuelve aquí con ?code=...&state=... */
export function googleCallbackHandler() {
  return async (c: Context) => {
    const fail = (reason: string) => c.redirect(`/login?error=${reason}`, 302);

    const expectedState = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/api/oauth" });

    if (c.req.query("error")) return fail("cancelled");

    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state || !expectedState || state !== expectedState) {
      return fail("state");
    }

    try {
      const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          redirect_uri: redirectUri(c),
        }).toString(),
      });
      if (!tokenResp.ok) {
        console.error("[google] token exchange failed", tokenResp.status, await tokenResp.text());
        return fail("token");
      }
      const { id_token } = (await tokenResp.json()) as { id_token?: string };
      if (!id_token) return fail("token");

      const { payload } = await jose.jwtVerify(id_token, GOOGLE_JWKS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: env.googleClientId,
      });

      const sub = payload.sub;
      const email =
        typeof payload.email === "string" ? payload.email.toLowerCase() : null;
      if (!sub || !email || payload.email_verified !== true) {
        return fail("email");
      }

      const unionId = `google:${sub}`;
      await upsertUser({
        unionId,
        name: typeof payload.name === "string" ? payload.name : email,
        email,
        avatar: typeof payload.picture === "string" ? payload.picture : null,
        lastSignInAt: new Date(),
      });

      const token = await signSessionToken({ unionId });
      setCookie(c, Session.cookieName, token, {
        ...getSessionCookieOptions(c.req.raw.headers),
        maxAge: Session.maxAgeMs / 1000,
      });
      return c.redirect("/", 302);
    } catch (err) {
      console.error("[google] callback failed", err);
      return fail("server");
    }
  };
}
