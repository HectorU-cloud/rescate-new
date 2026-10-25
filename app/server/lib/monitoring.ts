import { buildEnvelope, createThrottle, parseDsn } from "@contracts/monitoring";
import { env } from "./env";

const target = parseDsn(env.sentryDsn);
const allow = createThrottle();

if (env.sentryDsn && !target) console.warn("[monitoring] SENTRY_DSN no tiene un formato válido; no se reportarán errores.");

/** Avisa a Sentry de un error del servidor. Nunca lanza ni retrasa la respuesta al usuario. */
export function reportError(error: unknown, tags?: Record<string, string | number | undefined>, userId?: number) {
  if (!target) return;
  try {
    const key = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    if (!allow(key)) return;
    const body = buildEnvelope({ error, platform: "node", environment: env.sentryEnvironment, tags, userId });
    void fetch(target.url, { method: "POST", body, signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
  } catch {
    // el monitoreo jamás debe romper la app
  }
}

let installed = false;
/** Reporta las excepciones que tumbarían el proceso. No cambia su comportamiento: Node sigue terminando igual. */
export function installProcessMonitoring() {
  if (installed || !target) return;
  installed = true;
  process.on("uncaughtExceptionMonitor", (error) => reportError(error, { source: "uncaughtException" }));
}
