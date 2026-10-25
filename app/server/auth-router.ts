import * as cookie from "cookie";
import { eq, sql } from "drizzle-orm";
import { pushTokens, users } from "@db/schema";
import { getDb } from "./queries/connection";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery } from "./middleware";
import { toSafeUser } from "./lib/safe-user";

function clearSessionCookie(headers: Headers, resHeaders: Headers) {
  const opts = getSessionCookieOptions(headers);
  resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, "", {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 0,
    }),
  );
}

export const authRouter = createRouter({
  // Solo datos seguros: nunca el hash de la contraseña ni la versión de sesión
  me: authedQuery.query((opts) => toSafeUser(opts.ctx.user)),
  logout: authedQuery.mutation(async ({ ctx }) => {
    clearSessionCookie(ctx.req.headers, ctx.resHeaders);
    return { success: true };
  }),
  // Cierra la sesión en TODOS los dispositivos (celular perdido, computadora compartida…):
  // invalida las sesiones anteriores y deja de enviar notificaciones push a esos aparatos.
  logoutEverywhere: authedQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, ctx.user.id));
    await db.delete(pushTokens).where(eq(pushTokens.userId, ctx.user.id));
    clearSessionCookie(ctx.req.headers, ctx.resHeaders);
    return { success: true };
  }),
});
