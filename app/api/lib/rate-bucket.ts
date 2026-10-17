/**
 * Contador de intentos en memoria (por proceso), con ventana de tiempo. Sin dependencias de configuración.
 */
type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();
let lastSweep = 0;

/** Registra un intento en `key`. Devuelve si todavía está permitido y cuántos segundos faltan para reintentar. */
export function consume(key: string, windowMs: number, max: number, now = Date.now()) {
  if (now - lastSweep > 60_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const current = buckets.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  entry.count += 1;
  buckets.set(key, entry);
  return { allowed: entry.count <= max, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
}

export function clearBucket(key: string) {
  buckets.delete(key);
}
