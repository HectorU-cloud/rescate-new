import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { Paths } from "@contracts/constants";
import { env } from "../lib/env";
import { rateLimit } from "../lib/rate-limit";
import { googleCallbackHandler, googleLoginHandler } from "./google";
import { devLoginHandler } from "./dev-login";
import { emailRegister, emailLogin, resendVerification, verifyEmail, requestPasswordReset, resetPassword } from "./email";

const HOUR = 60 * 60 * 1000;
const QUARTER = 15 * 60 * 1000;

/** Rutas de autenticación (Google, correo y contraseña, y el acceso de pruebas solo en desarrollo). */
export function registerAuthRoutes(app: Hono<{ Bindings: HttpBindings }>) {
  app.get(Paths.googleLogin, googleLoginHandler());
  app.get(Paths.googleCallback, googleCallbackHandler());
  app.post("/api/auth/email/register", rateLimit({ windowMs: HOUR, max: 5, prefix: "auth-register" }), emailRegister);
  app.post("/api/auth/email/resend", rateLimit({ windowMs: HOUR, max: 5, prefix: "auth-resend" }), resendVerification);
  app.post("/api/auth/email/login", rateLimit({ windowMs: QUARTER, max: 10, prefix: "auth-login" }), emailLogin);
  app.get("/api/auth/email/verify", rateLimit({ windowMs: QUARTER, max: 30, prefix: "auth-verify" }), verifyEmail);
  app.post("/api/auth/email/forgot", rateLimit({ windowMs: HOUR, max: 5, prefix: "auth-forgot" }), requestPasswordReset);
  app.post("/api/auth/email/reset", rateLimit({ windowMs: QUARTER, max: 10, prefix: "auth-reset" }), resetPassword);
  if (env.devLogin) {
    console.warn("[auth] DEV_LOGIN activo: /api/dev-login habilitado (solo desarrollo)");
    app.get("/api/dev-login", devLoginHandler());
  }
}
