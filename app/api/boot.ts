import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { googleCallbackHandler, googleLoginHandler } from "./auth/google";
import { devLoginHandler } from "./auth/dev-login";
import { emailRegister, emailLogin, verifyEmail, requestPasswordReset, resetPassword } from "./auth/email";
import { Paths } from "@contracts/constants";
import { rateLimit } from "./lib/rate-limit";
import { startMaintenance } from "./lib/maintenance";

const app = new Hono<{ Bindings: HttpBindings }>();

// Cancela pedidos vencidos y recuerda a los repartidores (cada minuto).
startMaintenance();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.googleLogin, googleLoginHandler());
app.get(Paths.googleCallback, googleCallbackHandler());
app.post("/api/auth/email/register", rateLimit({ windowMs: 60 * 60 * 1000, max: 5, prefix: "auth-register" }), emailRegister);
app.post("/api/auth/email/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10, prefix: "auth-login" }), emailLogin);
app.get("/api/auth/email/verify", rateLimit({ windowMs: 15 * 60 * 1000, max: 30, prefix: "auth-verify" }), verifyEmail);
app.post("/api/auth/email/forgot", rateLimit({ windowMs: 60 * 60 * 1000, max: 5, prefix: "auth-forgot" }), requestPasswordReset);
app.post("/api/auth/email/reset", rateLimit({ windowMs: 15 * 60 * 1000, max: 10, prefix: "auth-reset" }), resetPassword);
if (env.devLogin) {
  console.warn("[auth] DEV_LOGIN activo: /api/dev-login habilitado (solo desarrollo)");
  app.get("/api/dev-login", devLoginHandler());
}
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
