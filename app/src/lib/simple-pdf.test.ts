import { describe, expect, it } from "vitest";
import { PdfBuilder, textWidth, toLatin1 } from "@/lib/simple-pdf";
import { buildDayReportPdf, reportFileName, type DayReportData } from "@/lib/report-pdf";

const decode = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

describe("PdfBuilder", () => {
  it("genera un PDF con tabla de referencias cruzadas que apunta a cada objeto", () => {
    const pdf = new PdfBuilder("Prueba");
    pdf.text("Hola ñandú (con paréntesis) \\ y barra", { size: 12, bold: true });
    pdf.row([{ text: "Izquierda", x: 48 }, { text: "$10.45", x: 547, align: "right" }]);
    const raw = decode(pdf.build());
    expect(raw.startsWith("%PDF-1.4")).toBe(true);
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(raw)![1]);
    expect(raw.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...raw.matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThanOrEqual(7);
    offsets.forEach((offset, i) => expect(raw.slice(offset, offset + 7)).toBe(`${i + 1} 0 obj`));
  });

  it("pasa a otra página cuando no cabe más", () => {
    const pdf = new PdfBuilder("Largo");
    for (let i = 0; i < 200; i++) pdf.text(`Línea ${i}`);
    expect(decode(pdf.build()).match(/\/Type \/Page /g)!.length).toBeGreaterThan(2);
  });

  it("deja solo caracteres Latin-1 y mide el texto", () => {
    expect(toLatin1("Año – “ok” …🙂")).toBe('Año - "ok" ...?');
    expect(textWidth("iii", 10)).toBeLessThan(textWidth("WWW", 10));
    expect(textWidth("á", 10)).toBe(textWidth("a", 10));
  });
});

describe("buildDayReportPdf", () => {
  const data: DayReportData = {
    businessName: "Picantería Doña Rosa", day: "2026-11-12", generatedAt: "2026-11-12T23:10:00Z",
    orders: [{ code: "RES-1", type: "delivery", fulfillmentMethod: "delivery", status: "delivered", subtotal: 10, serviceFee: 0.45, deliveryFee: 1.5, at: "2026-11-12T18:30:00Z" }],
    totals: { delivered: 1, cancelled: 0, sales: 10, serviceFees: 0.45, deliveryFees: 1.5 },
    cut: { from: "2026-11-01", to: "2026-11-15", openingBalance: 0, charges: 0.45, payments: 0, adjustments: 0, closingBalance: 0.45, pendingPayments: 0 },
  };
  it("incluye ventas y la tarifa que se debe", () => {
    const raw = decode(buildDayReportPdf(data));
    expect(raw).toContain("$10.00");
    expect(raw).toContain("$0.45");
    expect(raw).toContain("RES-1");
  });
  it("el nombre del archivo no lleva tildes ni espacios", () => {
    expect(reportFileName(data)).toBe("reporte-picanteria-dona-rosa-2026-11-12.pdf");
  });
});
