/**
 * Generador de PDF mínimo (A4, Helvetica) sin dependencias: texto, líneas y franjas de color, con salto de página.
 * Sirve para los reportes del local. Solo admite caracteres Latin-1 (español completo); lo demás se reemplaza.
 */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;

// Anchos de Helvetica (AFM, por 1000 unidades) para los caracteres ASCII 32–126.
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Deja solo caracteres que el PDF (WinAnsi/Latin-1) puede dibujar. */
export function toLatin1(text: string): string {
  return text
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/gu, "?");
}

function charWidth(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return WIDTHS[code - 32];
  const base = ch.normalize("NFD").charCodeAt(0); // á → a, ñ → n…
  return base >= 32 && base <= 126 ? WIDTHS[base - 32] : 556;
}

/** Ancho aproximado del texto en puntos (la negrita se calcula un poco más ancha). */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of toLatin1(text)) units += charWidth(ch);
  return (units / 1000) * size * (bold ? 1.06 : 1);
}

const esc = (text: string) => toLatin1(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (n: number) => n.toFixed(2);

export type Cell = { text: string; x: number; align?: "left" | "right"; bold?: boolean };

export class PdfBuilder {
  readonly width = PAGE_W;
  readonly margin = MARGIN;
  private title: string;
  private pages: string[] = [];
  private ops: string[] = [];
  private y = PAGE_H - MARGIN;

  constructor(title: string) {
    this.title = title;
  }

  /** Borde derecho del área útil (para alinear columnas a la derecha). */
  get contentRight() {
    return PAGE_W - MARGIN;
  }

  private newPage() {
    this.pages.push(this.ops.join("\n"));
    this.ops = [];
    this.y = PAGE_H - MARGIN;
  }

  private ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  space(points: number) {
    this.y -= points;
  }

  private drawText(text: string, x: number, size: number, bold: boolean, gray = 0.1) {
    this.ops.push(`BT ${gray} ${gray} ${gray} rg /${bold ? "F2" : "F1"} ${size} Tf ${num(x)} ${num(this.y)} Td (${esc(text)}) Tj ET`);
  }

  /** Una línea de texto (se corta con «…» si no cabe). */
  text(text: string, opts: { size?: number; bold?: boolean; x?: number; gray?: number } = {}) {
    const size = opts.size ?? 10;
    this.ensure(size * 1.5);
    this.y -= size;
    this.drawText(this.fit(text, size, opts.bold ?? false, (opts.x ?? MARGIN)), opts.x ?? MARGIN, size, opts.bold ?? false, opts.gray);
    this.y -= size * 0.5;
  }

  /** Varias columnas en la misma línea. */
  row(cells: Cell[], opts: { size?: number; gray?: number } = {}) {
    const size = opts.size ?? 10;
    this.ensure(size * 1.6);
    this.y -= size;
    for (const cell of cells) {
      const bold = cell.bold ?? false;
      const text = this.fit(cell.text, size, bold, cell.align === "right" ? MARGIN : cell.x);
      const x = cell.align === "right" ? cell.x - textWidth(text, size, bold) : cell.x;
      this.drawText(text, x, size, bold, opts.gray);
    }
    this.y -= size * 0.6;
  }

  /** Franja de color de fondo (por ejemplo, el encabezado de una tabla). Se dibuja alrededor de la línea siguiente. */
  band(height: number, gray = 0.93) {
    this.ensure(height);
    this.ops.push(`${gray} ${gray} ${gray} rg ${num(MARGIN)} ${num(this.y - height + 2)} ${num(PAGE_W - MARGIN * 2)} ${num(height)} re f`);
  }

  rule(gray = 0.75) {
    this.ensure(8);
    this.y -= 4;
    this.ops.push(`${gray} G 0.6 w ${num(MARGIN)} ${num(this.y)} m ${num(PAGE_W - MARGIN)} ${num(this.y)} l S`);
    this.y -= 4;
  }

  private fit(text: string, size: number, bold: boolean, x: number): string {
    const max = PAGE_W - MARGIN - x;
    const clean = toLatin1(text);
    if (textWidth(clean, size, bold) <= max) return clean;
    let out = clean;
    while (out.length > 1 && textWidth(`${out}...`, size, bold) > max) out = out.slice(0, -1);
    return `${out}...`;
  }

  build(): Uint8Array {
    this.pages.push(this.ops.join("\n"));
    this.ops = [];
    const n = this.pages.length;
    const objs: string[] = [];
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[2] = `<< /Type /Pages /Kids [${this.pages.map((_, k) => `${7 + 2 * k} 0 R`).join(" ")}] /Count ${n} >>`;
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objs[5] = `<< /Title (${esc(this.title)}) /Producer (Al Rescate) >>`;
    this.pages.forEach((content, k) => {
      objs[7 + 2 * k - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
      objs[7 + 2 * k] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + 2 * k - 1} 0 R >>`;
    });
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
