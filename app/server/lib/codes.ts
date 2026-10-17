import { timingSafeEqual } from "node:crypto";

/** Compara dos códigos numéricos en tiempo constante. */
export function codesMatch(expected: string | null | undefined, given: string): boolean {
  if (!expected || expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}
