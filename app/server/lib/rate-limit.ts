import type { MiddlewareHandler } from "hono";
import { env } from "./env";
import { clientIp } from "./client-ip";
import { consume } from "./rate-bucket";

export { consume, clearBucket } from "./rate-bucket";

/**
 * Limitador por IP para endpoints sensibles. Con varias instancias conviene además un límite
 * compartido en el proxy/CDN o con Redis. La IP del cliente sale de `clientIp` (ver TRUSTED_PROXY_HOPS).
 */
export function rateLimit(options: { windowMs: number; max: number; prefix: string }): MiddlewareHandler {
  return async (c, next) => {
    const { allowed, retryAfterSec } = consume(`${options.prefix}:${clientIp(c, env.trustedProxyHops)}`, options.windowMs, options.max);
    if (!allowed) {
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: "Demasiados intentos. Espera un momento y vuelve a intentarlo." }, 429);
    }
    await next();
  };
}
