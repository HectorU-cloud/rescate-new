import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { money } from "@/lib/format";

const card = "rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border";
const pct = (n: number) => `${Math.round(n * 100)}%`;
const mins = (n: number | null) => (n === null ? "—" : `${n} min`);

/** Resultados de la simulación del precio dinámico: lo que se habría sugerido cobrar. No se cobra nada de esto. */
export default function AdminPricingSimulation() {
  const [days, setDays] = useState(30);
  const report = trpc.admin.pricingSimulationReport.useQuery({ days }, { retry: false });
  const r = report.data;

  return <section className={card}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-extrabold">Precio dinámico (simulación)</h2>
        <p className="mt-1 text-xs text-muted-foreground">Lo que se habría sugerido según tráfico y demanda. Los clientes siguen pagando la tarifa normal; esto sirve para decidir si conviene activarlo.</p>
      </div>
      <select aria-label="Período" className="rounded-xl border border-input bg-background px-2 py-1.5 text-xs font-bold" value={days} onChange={(e) => setDays(Number(e.target.value))}>
        <option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option>
      </select>
    </div>

    {report.isLoading && <p className="mt-3 text-sm text-muted-foreground">Cargando…</p>}
    {report.error && <p className="mt-3 text-sm text-destructive">{report.error.message}</p>}
    {r && r.orders === 0 && <p className="mt-3 text-sm text-muted-foreground">Todavía no hay pedidos a domicilio con simulación en este período.</p>}
    {r && r.orders > 0 && <>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-secondary p-3"><p className="text-[11px] font-bold text-muted-foreground">Pedidos simulados</p><p className="text-xl font-extrabold">{r.orders}</p></div>
        <div className="rounded-xl bg-secondary p-3"><p className="text-[11px] font-bold text-muted-foreground">Con recargo sugerido</p><p className="text-xl font-extrabold">{pct(r.surgeShare)}</p><p className="text-[10px] text-muted-foreground">{r.withSurge} pedidos</p></div>
        <div className="rounded-xl bg-secondary p-3"><p className="text-[11px] font-bold text-muted-foreground">Multiplicador medio (con recargo)</p><p className="text-xl font-extrabold">×{r.avgMultiplierWhenSurge.toFixed(2)}</p></div>
        <div className="rounded-xl bg-secondary p-3"><p className="text-[11px] font-bold text-muted-foreground">Ingreso extra hipotético</p><p className="text-xl font-extrabold">{money(r.hypotheticalExtra)}</p></div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Señales activas: tráfico en {r.bySignal.traffic} pedidos, demanda en {r.bySignal.demand}, clima en {r.bySignal.weather}. Topes alcanzados: {r.cappedCount}.</p>
      <div className="mt-3 rounded-xl border border-border p-3 text-sm">
        <p className="font-extrabold">¿Los pedidos con recargo tardan más?</p>
        <p className="mt-1 text-xs text-muted-foreground">Tiempo real desde que el repartidor aceptó hasta la entrega.</p>
        <p className="mt-2">Con recargo sugerido: <b>{mins(r.realMinutes.surgeAvg)}</b> ({r.realMinutes.surgeSamples} entregas) · Sin recargo: <b>{mins(r.realMinutes.normalAvg)}</b> ({r.realMinutes.normalSamples} entregas)</p>
        {(r.realMinutes.surgeSamples < 20 || r.realMinutes.normalSamples < 20) && <p className="mt-1 text-xs text-amber-700">Pocas entregas todavía: no saques conclusiones hasta tener al menos unas 20 por grupo.</p>}
      </div>
    </>}
  </section>;
}
