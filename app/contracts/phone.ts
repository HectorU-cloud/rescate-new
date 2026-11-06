/**
 * Validación de teléfonos de Ecuador, compartida por el cliente (formularios) y el servidor.
 * Acepta separadores (espacios, guiones, puntos, paréntesis) y el prefijo de país (+593 / 593).
 * Devuelve el formato local normalizado, o null si no es válido.
 */

function localDigits(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return null;
  // Con prefijo de país: 593 + número sin el cero inicial (9 dígitos), o con él (10 dígitos).
  if (digits.startsWith("593") && digits.length >= 11) return digits.slice(3);
  return digits;
}

/** Celular: 09XXXXXXXX. También se acepta 9XXXXXXXX y +593 9XXXXXXXX. */
export function normalizeEcuadorMobile(input: string): string | null {
  const d = localDigits(input);
  if (d === null) return null;
  const withZero = /^9\d{8}$/.test(d) ? `0${d}` : d;
  return /^09\d{8}$/.test(withZero) ? withZero : null;
}

/** Celular o convencional (0[2-7]XXXXXXX, p. ej. 042123456). Para teléfonos de comercios. */
export function normalizeEcuadorPhone(input: string): string | null {
  const mobile = normalizeEcuadorMobile(input);
  if (mobile) return mobile;
  const d = localDigits(input);
  if (d === null) return null;
  const withZero = /^[2-7]\d{7}$/.test(d) ? `0${d}` : d;
  return /^0[2-7]\d{7}$/.test(withZero) ? withZero : null;
}

export const MOBILE_HINT = "Escribe un celular válido de Ecuador, por ejemplo 0991234567.";
export const PHONE_HINT = "Escribe un teléfono válido de Ecuador, por ejemplo 0991234567 o 042123456.";
