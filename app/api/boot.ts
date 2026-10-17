import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { registerAuthRoutes } from "./auth/routes";
import { startMaintenance } from "./lib/maintenance";

const app = new Hono<{ Bindings: HttpBindings }>();

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
