/**
 * Convierte filas en texto CSV (con BOM para que Excel respete las tildes).
 * Los textos que empiezan con = + - @ se neutralizan con una comilla: nombres de comercios o personas
 * los escribe cualquiera y Excel los ejecutaría como fórmulas al abrir el archivo.
 */
export type CsvCell = string | number | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? String(value) : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: CsvCell[][]): string {
  return `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
