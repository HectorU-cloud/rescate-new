import type { MiddlewareHandler } from "hono";

/**
 * Small per-process limiter for sensitive auth endpoints.
 * Production deployments with multiple instances should also apply a shared
 * limiter at the proxy/CDN or use Redis. Configure the proxy to overwrite
 * X-Forwarded-For; otherwise clients may spoof that header.
 */
type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();
let lastSweep = 0;

export function rateLimit(options: {
  windowMs: number;
  max: number;
  prefix: string;
}): MiddlewareHandler {
  return async (c, next) => {
    const now = Date.now();
    if (now - lastSweep > 60_000) {
      for (const [key, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(key);
      }
      lastSweep = now;
    }

    // The reverse proxy must replace this header, not append user-provided data.
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || c.req.header("x-real-ip") || "unknown";
    const key = `${options.prefix}:${ip}`;
    const current = buckets.get(key);
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;

    entry.count += 1;
    buckets.set(key, entry);

    if (entry.count > options.max) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return c.json({ error: "Demasiados intentos. Espera un momento y vuelve a intentarlo." }, 429);
    }

    await next();
  };
}
