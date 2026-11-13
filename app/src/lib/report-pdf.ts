import { PdfBuilder } from "@/lib/simple-pdf";

export type DayReportData = {
  businessName: string;
  day: string; // AAAA-MM-DD
  generatedAt: string; // ISO
  orders: Array<{
    code: string;
    type: "delivery" | "rescue";
    fulfillmentMethod: "delivery" | "pickup";
    status: string;
    subtotal: number;
    serviceFee: number;
    deliveryFee: number;
    at: string | null;
  }>;
  totals: { delivered: number; cancelled: number; sales: number; serviceFees: number; deliveryFees: number };
  cut: { from: string; to: string; openingBalance: number; charges: number; payments: number; adjustments: number; closingBalance: number; pendingPayments: number };
};

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const TZ = "America/Guayaquil";

/** «2026-11-12» → «jueves, 12 de noviembre de 2026» (sin pasar por la zona horaria del equipo). */
export function longDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "UTC" });
}

const hour = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "-");
const kind = (o: DayReportData["orders"][number]) => (o.type === "rescue" ? "Rescate" : o.fulfillmentMethod === "pickup" ? "Retiro en local" : "Domicilio");

export function reportFileName(data: Pick<DayReportData, "businessName" | "day">): string {
  const slug = data.businessName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "local";
  return `reporte-${slug}-${data.day}.pdf`;
}

export function buildDayReportPdf(data: DayReportData): Uint8Array {
  const pdf = new PdfBuilder(`Reporte de ventas ${data.day} - ${data.businessName}`);
  const L = pdf.margin;
  const R = pdf.contentRight;

  pdf.text("Reporte de ventas", { size: 20, bold: true });
  pdf.text(data.businessName, { size: 13, bold: true });
  pdf.text(longDay(data.day), { size: 11 });
  pdf.text(`Generado el ${new Date(data.generatedAt).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: TZ })}`, { size: 8, gray: 0.4 });
  pdf.space(6);
  pdf.rule();

  pdf.text("Resumen del día", { size: 12, bold: true });
  pdf.space(2);
  const line = (label: string, value: string, bold = false) => pdf.row([{ text: label, x: L, bold }, { text: value, x: R, align: "right", bold }], { size: 11 });
  line("Pedidos entregados", String(data.totals.delivered));
  line("Pedidos cancelados", String(data.totals.cancelled));
  line("Ventas del día (sin envío)", money(data.totals.sales), true);
  line("Tarifa de servicio Rescate que debes por hoy", money(data.totals.serviceFees), true);
  pdf.text("Los envíos son del repartidor y no están incluidos en las ventas.", { size: 8, gray: 0.4 });
  pdf.space(6);
  pdf.rule();

  pdf.text(`Corte quincenal: del ${shortDay(data.cut.from)} al ${shortDay(data.cut.to)}`, { size: 12, bold: true });
  pdf.space(2);
  line("Saldo anterior", money(data.cut.openingBalance));
  line("Tarifa de servicio acumulada en el corte", money(data.cut.charges));
  line("Pagos confirmados en el corte", money(data.cut.payments));
  if (data.cut.adjustments !== 0) line("Ajustes", money(data.cut.adjustments));
  line("Saldo pendiente con Rescate", money(data.cut.closingBalance), true);
  if (data.cut.pendingPayments > 0) pdf.text(`Pagos por verificar: ${money(data.cut.pendingPayments)} (aún no descuentan del saldo).`, { size: 8, gray: 0.4 });
  pdf.space(6);
  pdf.rule();

  pdf.text("Detalle de pedidos", { size: 12, bold: true });
  pdf.space(2);
  if (data.orders.length === 0) {
    pdf.text("No hubo pedidos entregados ni cancelados este día.", { size: 10, gray: 0.4 });
  } else {
    const cols = { code: L + 4, hour: L + 120, kind: L + 175, sale: R - 90, fee: R - 4 };
    pdf.band(14);
    pdf.row([
      { text: "Pedido", x: cols.code, bold: true },
      { text: "Hora", x: cols.hour, bold: true },
      { text: "Tipo", x: cols.kind, bold: true },
      { text: "Venta", x: cols.sale, align: "right", bold: true },
      { text: "Tarifa Rescate", x: cols.fee, align: "right", bold: true },
    ], { size: 9 });
    for (const o of data.orders) {
      const cancelled = o.status === "cancelled";
      pdf.row([
        { text: o.code, x: cols.code },
        { text: hour(o.at), x: cols.hour },
        { text: cancelled ? `${kind(o)} (cancelado)` : kind(o), x: cols.kind },
        { text: cancelled ? "-" : money(o.subtotal), x: cols.sale, align: "right" },
        { text: cancelled || o.type !== "delivery" ? "-" : money(o.serviceFee), x: cols.fee, align: "right" },
      ], { size: 9, gray: cancelled ? 0.5 : 0.1 });
    }
    pdf.rule();
    pdf.row([
      { text: "Total", x: cols.code, bold: true },
      { text: money(data.totals.sales), x: cols.sale, align: "right", bold: true },
      { text: money(data.totals.serviceFees), x: cols.fee, align: "right", bold: true },
    ], { size: 10 });
  }
  return pdf.build();
}

/** Descarga el PDF en el dispositivo (en navegadores que bloquean la descarga, lo abre en otra pestaña). */
export function downloadPdf(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
