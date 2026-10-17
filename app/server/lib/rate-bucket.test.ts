import { describe, expect, it } from "vitest";
import { clearBucket, consume } from "./rate-bucket";

let n = 0;
const key = () => `test:${Date.now()}:${n++}`;
const MIN = 60_000;

describe("consume (contador con ventana)", () => {
  it("permite hasta el máximo y bloquea el siguiente", () => {
    const k = key(); const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(consume(k, MIN, 3, t).allowed).toBe(true);
    expect(consume(k, MIN, 3, t).allowed).toBe(false);
    expect(consume(k, MIN, 3, t).allowed).toBe(false);
  });
  it("informa cuántos segundos faltan para poder reintentar", () => {
    const k = key(); const t = 2_000_000;
    consume(k, 10 * MIN, 1, t);
    expect(consume(k, 10 * MIN, 1, t + 30_000).retryAfterSec).toBe(570);
  });
  it("al terminar la ventana el contador empieza de nuevo", () => {
    const k = key(); const t = 3_000_000;
    consume(k, MIN, 1, t); expect(consume(k, MIN, 1, t + 1).allowed).toBe(false);
    expect(consume(k, MIN, 1, t + MIN + 1).allowed).toBe(true);
  });
  it("cada clave cuenta por separado", () => {
    const a = key(); const b = key(); const t = 4_000_000;
    consume(a, MIN, 1, t); expect(consume(a, MIN, 1, t).allowed).toBe(false);
    expect(consume(b, MIN, 1, t).allowed).toBe(true);
  });
  it("clearBucket reinicia una clave (p. ej. tras un inicio de sesión correcto)", () => {
    const k = key(); const t = 5_000_000;
    consume(k, MIN, 1, t); expect(consume(k, MIN, 1, t).allowed).toBe(false);
    clearBucket(k);
    expect(consume(k, MIN, 1, t).allowed).toBe(true);
  });
});
