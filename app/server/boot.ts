import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { registerAuthRoutes } from "./auth/routes";
import { startMaintenance } from "./lib/maintenance";
import { installProcessMonitoring, reportError } from "./lib/monitoring";
import { getDb } from "./queries/connection";
import { sql } from "drizzle-orm";

const app = new Hono<{ Bindings: HttpBindings }>();

installProcessMonitoring();

// Errores no controlados de cualquier ruta: al log (Railway) y a Sentry; el cliente no recibe detalles.
app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}`, err);
  reportError(err, { path: c.req.path, method: c.req.method });
  return c.json({ error: "Internal Server Error" }, 500);
});

// Cancela pedidos vencidos y recuerda a los repartidores (cada minuto).
startMaintenance();

// La API solo recibe JSON pequeño (las fotos suben directo a R2): 2 MB bastan y limitan el abuso
app.use(bodyLimit({ maxSize: 2 * 1024 * 1024 }));
registerAuthRoutes(app);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
    onError({ error, path }) {
      // Solo los fallos del servidor (no "sin permiso", "datos inválidos", etc., que son normales)
      if (error.code !== "INTERNAL_SERVER_ERROR") return;
      console.error(`[trpc] ${path ?? "?"}`, error);
      reportError(error.cause ?? error, { path });
    },
  });
});

// Para monitores de disponibilidad (UptimeRobot, Better Stack…): responde 200 solo si la base de datos contesta.
app.get("/api/health", async (c) => {
  c.header("Cache-Control", "no-store");
  try {
    await getDb().execute(sql`select 1`);
    return c.json({ ok: true });
  } catch (error) {
    reportError(error, { path: "/api/health" });
    return c.json({ ok: false }, 503);
  }
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
