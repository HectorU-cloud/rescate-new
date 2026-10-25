import { buildEnvelope, createThrottle, parseDsn } from "@contracts/monitoring";

const target = import.meta.env.PROD ? parseDsn(import.meta.env.VITE_SENTRY_DSN as string | undefined) : null;
const allow = createThrottle(10);

/** Avisa a Sentry de un error del navegador. Nunca lanza. */
export function reportError(error: unknown, tags?: Record<string, string | number | undefined>) {
  if (!target) return;
  try {
    const key = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    if (!allow(key)) return;
    const body = buildEnvelope({
      error,
      platform: "javascript",
      environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || "production",
      // Solo la ruta, sin parámetros (podrían llevar tokens de recuperación de contraseña)
      tags: { route: window.location.pathname, ...tags },
    });
    void fetch(target.url, { method: "POST", body, keepalive: true }).catch(() => undefined);
  } catch {
    // el monitoreo jamás debe romper la app
  }
}

/** Captura errores no controlados y promesas rechazadas. Llamar una vez al arrancar. */
export function initMonitoring() {
  if (!target) return;
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, { source: "window.onerror" }));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, { source: "unhandledrejection" }));
}
