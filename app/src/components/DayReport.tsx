import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { money } from "@/lib/format";
import { ecuadorDay } from "@contracts/fees";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildDayReportPdf, downloadPdf, longDay, reportFileName, shortDay } from "@/lib/report-pdf";
import { toast } from "sonner";

/**
 * Reporte del día del local: ventas, tarifa de servicio que debe a Rescate y corte quincenal, con descarga en PDF.
 * Se abre desde el botón «Reporte del día» y automáticamente al cerrar el local.
 */
export default function DayReport({ open, onOpenChange, justClosed = false }: { open: boolean; onOpenChange: (open: boolean) => void; justClosed?: boolean }) {
  const today = ecuadorDay();
  const [day, setDay] = useState(today);
  const report = trpc.business.report.useQuery({ date: day }, { enabled: open });
  const data = report.data;

  const download = () => {
    if (!data) return;
    try {
      downloadPdf(buildDayReportPdf(data), reportFileName(data));
    } catch {
      toast.error("No pudimos generar el PDF. Intenta de nuevo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{justClosed ? "Local cerrado · reporte del día" : "Reporte del día"}</DialogTitle>
          <DialogDescription>
            {justClosed ? "Así te fue hoy. Puedes descargarlo en PDF." : "Ventas y tarifa de servicio que le debes a Rescate."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="report-day" className="text-xs font-extrabold text-muted-foreground">Día</label>
          <input
            id="report-day"
            type="date"
            value={day}
            max={today}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-bold"
          />
          {day !== today && (
            <button type="button" onClick={() => setDay(today)} className="text-xs font-extrabold text-brand underline">Hoy</button>
          )}
        </div>

        {report.isLoading && <div className="h-40 animate-pulse rounded-2xl bg-muted" />}
        {report.isError && <p className="rounded-2xl bg-destructive/10 p-4 text-sm font-bold text-destructive">{report.error.message}</p>}
        {data && (
          <div className="space-y-4">
            <p className="text-sm font-bold capitalize">{longDay(data.day)}</p>
            <div className="grid grid-cols-2 gap-2">
              <Box label="Ventas (sin envío)" value={money(data.totals.sales)} strong />
              <Box label="Tarifa Rescate que debes" value={money(data.totals.serviceFees)} strong />
              <Box label="Entregados" value={String(data.totals.delivered)} />
              <Box label="Cancelados" value={String(data.totals.cancelled)} />
            </div>
            <p className="text-[11px] text-muted-foreground">Los envíos son del repartidor y no cuentan en tus ventas.</p>

            <div className="rounded-2xl bg-secondary p-3 text-sm">
              <p className="text-xs font-extrabold">Corte quincenal: del {shortDay(data.cut.from)} al {shortDay(data.cut.to)}</p>
              <dl className="mt-2 space-y-1 text-xs">
                <Line label="Saldo anterior" value={money(data.cut.openingBalance)} />
                <Line label="Tarifa acumulada en el corte" value={money(data.cut.charges)} />
                <Line label="Pagos confirmados" value={money(data.cut.payments)} />
                <Line label="Saldo pendiente con Rescate" value={money(data.cut.closingBalance)} strong />
              </dl>
            </div>

            {data.orders.length > 0 && (
              <details className="rounded-2xl border border-border p-3">
                <summary className="cursor-pointer text-xs font-extrabold">Ver los {data.orders.length} pedidos del día</summary>
                <ul className="mt-2 divide-y divide-border text-xs">
                  {data.orders.map((o) => (
                    <li key={o.code} className={`flex items-center justify-between gap-2 py-1.5 ${o.status === "cancelled" ? "text-muted-foreground line-through" : ""}`}>
                      <span className="font-bold">{o.code}</span>
                      <span>{o.status === "cancelled" ? "Cancelado" : money(o.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <button type="button" onClick={download} className="w-full rounded-xl bg-brand py-3 text-sm font-extrabold text-white">
              📄 Descargar PDF
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Box({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
      <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-display ${strong ? "text-xl" : "text-lg"} font-extrabold`}>{value}</p>
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "font-extrabold" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
