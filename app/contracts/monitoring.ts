/**
 * Reporte de errores a Sentry sin dependencias (funciona igual en el navegador y en Node).
 *
 * Envía eventos al endpoint "envelope" de Sentry con `fetch`. No usa el SDK oficial a propósito: el servidor se
 * empaqueta con esbuild y @sentry/node (OpenTelemetry) no se lleva bien con ese empaquetado. A cambio no hay
 * breadcrumbs ni sourcemaps; si más adelante los necesitas, cambia solo `reportError` por el SDK oficial.
 *
 * Privacidad: solo se envían mensaje, pila, ruta/etiquetas técnicas y el id numérico del usuario si se pasa.
 * Los correos que aparezcan en un mensaje se tapan antes de enviar. Nunca se envían cookies, cabeceras ni cuerpos.
 */

export type SentryTarget = { url: string };

/** DSN con forma https://CLAVE@oXXXX.ingest.sentry.io/PROYECTO → URL del endpoint, o null si no es válido. */
export function parseDsn(dsn: string | undefined | null): SentryTarget | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn.trim());
    const projectId = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!/^https?:$/.test(u.protocol) || !u.username || !/^\d+$/.test(projectId)) return null;
    return { url: `${u.protocol}//${u.host}/api/${projectId}/envelope/?sentry_version=7&sentry_key=${encodeURIComponent(u.username)}&sentry_client=rescate-lite%2F1.0` };
  } catch {
    return null;
  }
}

const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g;
export const scrub = (text: string, max = 1000) => text.replace(EMAIL, "[correo]").slice(0, max);

export type ErrorReport = {
  error: unknown;
  platform: "node" | "javascript";
  environment: string;
  tags?: Record<string, string | number | undefined>;
  userId?: number;
};

export function buildEnvelope(report: ErrorReport, now = new Date(), eventId: string = crypto.randomUUID().replace(/-/g, "")): string {
  const err = report.error;
  const name = err instanceof Error ? err.name || "Error" : "Error";
  const message = scrub(err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err) ?? String(err));
  const stack = err instanceof Error && err.stack ? scrub(err.stack, 4000) : undefined;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(report.tags ?? {})) if (v !== undefined) tags[k] = scrub(String(v), 200);
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: report.platform,
    level: "error",
    environment: report.environment,
    exception: { values: [{ type: name, value: message }] },
    tags,
    extra: stack ? { stack } : undefined,
    user: report.userId !== undefined ? { id: String(report.userId) } : undefined,
  };
  return [JSON.stringify({ event_id: eventId, sent_at: now.toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

/** Limitador simple: como mucho `max` envíos por minuto y el mismo mensaje una vez por minuto (evita tormentas de eventos). */
export function createThrottle(max = 20, windowMs = 60_000) {
  let windowStart = 0;
  let count = 0;
  const seen = new Map<string, number>();
  return (key: string, now = Date.now()) => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
      for (const [k, t] of seen) if (now - t >= windowMs) seen.delete(k);
    }
    const last = seen.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    if (count >= max) return false;
    count += 1;
    seen.set(key, now);
    return true;
  };
}
