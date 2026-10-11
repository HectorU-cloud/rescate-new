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

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.googleLogin, googleLoginHandler());
app.get(Paths.googleCallback, googleCallbackHandler());
app.post("/api/auth/email/register", emailRegister);
app.post("/api/auth/email/login", emailLogin);
app.get("/api/auth/email/verify", verifyEmail);
app.post("/api/auth/email/forgot", requestPasswordReset);
app.post("/api/auth/email/reset", resetPassword);
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
