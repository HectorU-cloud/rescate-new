/**
 * Campos numéricos de formularios: el valor se guarda como TEXTO mientras se escribe, así se puede borrar
 * por completo (con un número guardado, borrar el «0» lo dejaba pegado) y se valida al guardar.
 */

/** Convierte el texto a número (acepta coma decimal). Vacío o inválido → NaN. */
export function parseNumberInput(raw: string): number {
  const text = raw.trim().replace(",", ".");
  return text === "" ? NaN : Number(text);
}

/** Mensaje de error si el texto está vacío, no es un número o queda fuera del rango; null si es válido. */
export function rangeError(raw: string, min: number, max: number, message: string): string | null {
  const n = parseNumberInput(raw);
  if (Number.isNaN(n)) return "Escribe un valor.";
  return n < min || n > max ? message : null;
}
