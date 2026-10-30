import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { money } from "@/lib/format";
import { toCsv } from "@/lib/csv";

const card = "rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border";
const field = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm";
const DAY_FORMAT = new Intl.DateTimeFormat("es-EC", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Guayaquil" });

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Por defecto: el mes anterior completo (el que normalmente se liquida). */
function previousMonth() {
  const now = new Date();
  return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
}

/** Reportes de cargos, pagos y deuda por local y repartidor, más liquidaciones por período. */
export default function AdminFinanceReports() {
  const utils = trpc.useUtils();
  const defaults = useMemo(previousMonth, []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  const report = trpc.admin.financeReport.useQuery({ from, to }, { enabled: valid, retry: false });
  const history = trpc.admin.settlements.useQuery();
  const settle = trpc.admin.createSettlements.useMutation({
    onSuccess: (r) => {
      toast.success(r.created ? `Se generaron ${r.created} liquidaciones${r.skipped ? ` (${r.skipped} ya existían)` : ""}` : "Todas las cuentas de este período ya estaban liquidadas");
      utils.admin.settlements.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const download = () => {
    if (!report.data) return;
    const rows = [
      ["Tipo", "Cuenta", "Nombre", "Saldo inicial", "Cargos", "Pagos confirmados", "Ajustes", "Saldo final", "Pagos por verificar"],
      ...report.data.rows.map((r) => [r.walletType === "courier" ? "Repartidor" : "Negocio", r.walletId, r.name, r.openingBalance, r.charges, r.payments, r.adjustments, r.closingBalance, r.pendingPayments]),
    ];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `rescate-finanzas-${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const table = (type: "courier" | "business") => {
    const rows = (report.data?.rows ?? []).filter((r) => r.walletType === type);
    const totals = report.data?.totals[type];
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr><th className="py-1 pr-2">Cuenta</th><th className="px-2 text-right">Inicial</th><th className="px-2 text-right">Cargos</th><th className="px-2 text-right">Pagos</th><th className="px-2 text-right">Final</th><th className="pl-2 text-right">Por verificar</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.walletId} className="border-t border-border">
                <td className="py-1.5 pr-2 font-bold">{r.name}</td>
                <td className="px-2 text-right">{money(r.openingBalance)}</td>
                <td className="px-2 text-right">{money(r.charges)}</td>
                <td className="px-2 text-right">{money(r.payments)}</td>
                <td className={`px-2 text-right font-extrabold ${r.closingBalance > 0 ? "text-amber-700" : ""}`}>{money(r.closingBalance)}</td>
                <td className="pl-2 text-right">{r.pendingPayments ? money(r.pendingPayments) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="py-3 text-muted-foreground">Sin movimientos en este período.</td></tr>}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot><tr className="border-t-2 border-border font-extrabold"><td className="py-1.5 pr-2">Total</td><td /><td className="px-2 text-right">{money(totals.charges)}</td><td className="px-2 text-right">{money(totals.payments)}</td><td className="px-2 text-right">{money(totals.closingBalance)}</td><td /></tr></tfoot>
          )}
        </table>
      </div>
    );
  };

  return (
    <>
      <section className={card}>
        <h2 className="mb-1 text-lg font-extrabold">Reporte por período</h2>
        <p className="mb-3 text-xs text-muted-foreground">Cargos, pagos confirmados y deuda de cada local y repartidor (hora de Ecuador, ambas fechas incluidas). Un pago cuenta el día en que se confirma.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-bold">Desde<input className={`${field} mt-1`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-xs font-bold">Hasta<input className={`${field} mt-1`} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {!valid && <p className="mt-2 text-xs font-bold text-destructive">Elige un rango de fechas válido.</p>}
        {report.error && <p className="mt-2 text-xs font-bold text-destructive">{report.error.message}</p>}
        {report.isFetching && <div className="mt-3 h-16 animate-pulse rounded-xl bg-muted" />}
        {report.data && !report.isFetching && (
          <div className="mt-4 space-y-5">
            <div><h3 className="mb-1 text-sm font-extrabold">Repartidores</h3>{table("courier")}</div>
            <div><h3 className="mb-1 text-sm font-extrabold">Negocios</h3>{table("business")}</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={download} disabled={report.data.rows.length === 0} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-extrabold disabled:opacity-50">⬇️ Descargar CSV</button>
              <button
                disabled={settle.isPending || report.data.rows.length === 0}
                onClick={() => { if (window.confirm(`Generar la liquidación de ${from} a ${to} para las cuentas con movimientos? No se puede editar después.`)) settle.mutate({ from, to }); }}
                className="rounded-xl bg-brand px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
              >
                Generar liquidaciones del período
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-1 text-lg font-extrabold">Liquidaciones generadas</h2>
        <p className="mb-3 text-xs text-muted-foreground">Constancia del estado de cuenta de cada período. Cada repartidor y comercio ve las suyas en su estado de cuenta.</p>
        <div className="space-y-2">
          {(history.data ?? []).map((s) => (
            <article key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-xs">
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold">{s.name}</p>
                <p className="text-muted-foreground">{DAY_FORMAT.format(new Date(s.periodStart))} – {DAY_FORMAT.format(new Date(new Date(s.periodEnd).getTime() - 1))} · cargos {money(s.charges)} · pagos {money(s.payments)}</p>
              </div>
              <p className={`shrink-0 font-extrabold ${s.closingBalance > 0 ? "text-amber-700" : ""}`}>{money(s.closingBalance)}</p>
            </article>
          ))}
          {!history.isLoading && (history.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Aún no hay liquidaciones.</p>}
        </div>
      </section>
    </>
  );
}
