import { trpc } from "@/providers/trpc";
import { money, timeAgo } from "@/lib/format";
import PaymentReportForm from "@/components/PaymentReportForm";

const STATE_STYLE = {
  ok: "bg-card ring-border",
  warning: "bg-amber-50 ring-amber-300",
  blocked: "bg-red-50 ring-destructive",
} as const;

const DAY_FORMAT = new Intl.DateTimeFormat("es-EC", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Guayaquil" });
/** El fin del período se guarda exclusivo (00:00 del día siguiente): se muestra el último día incluido. */
function formatPeriod(start: Date | string, end: Date | string) {
  return `${DAY_FORMAT.format(new Date(start))} – ${DAY_FORMAT.format(new Date(new Date(end).getTime() - 1))}`;
}

const STATUS_LABEL = { pending: "Por verificar", confirmed: "Confirmado", rejected: "Rechazado" } as const;

/**
 * Estado de cuenta con Rescate para repartidores y comercios: cuánto deben, el límite y los últimos movimientos.
 * Si la deuda supera el límite que fija administración, no se pueden tomar/aceptar pedidos nuevos.
 */
export default function WalletCard() {
  const wallet = trpc.wallet.mine.useQuery(undefined, { refetchInterval: 60_000 });
  const settlements = trpc.wallet.mySettlements.useQuery(undefined, { enabled: !!wallet.data });
  const w = wallet.data;
  if (!w) return null;

  const isCourier = w.walletType === "courier";
  const percent = w.limit > 0 ? Math.min(100, Math.round((Math.max(0, w.balance) / w.limit) * 100)) : 0;
  const owes = w.balance > 0;

  return (
    <section className={`rounded-3xl p-4 shadow-sm ring-1 ${STATE_STYLE[w.state]}`} aria-label="Estado de cuenta">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Estado de cuenta</p>
          <p className="font-display mt-1 text-2xl font-extrabold">{owes ? money(w.balance) : money(Math.abs(w.balance))}</p>
          <p className="text-xs font-semibold text-muted-foreground">
            {owes ? "Saldo que debes a Rescate" : w.balance < 0 ? "Saldo a tu favor" : "Estás al día ✅"}
          </p>
        </div>
        {w.pendingPayments > 0 && (
          <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-extrabold">{money(w.pendingPayments)} por verificar</span>
        )}
      </div>

      {w.limit > 0 && owes && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Deuda frente al límite">
            <div className={`h-full ${w.state === "blocked" ? "bg-destructive" : w.state === "warning" ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-[11px] font-semibold text-muted-foreground">Límite permitido: {money(w.limit)}</p>
        </div>
      )}

      {w.state === "blocked" && (
        <p className="mt-3 rounded-xl bg-destructive px-3 py-2 text-xs font-extrabold text-white">
          ⛔ Tu saldo supera el límite: no puedes {isCourier ? "tomar" : "aceptar"} pedidos nuevos hasta que tu pago sea confirmado.
        </p>
      )}
      {w.state === "warning" && (
        <p className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900">
          ⚠️ Estás cerca del límite. Si lo superas no podrás {isCourier ? "tomar" : "aceptar"} pedidos nuevos.
        </p>
      )}
      {(w.state !== "ok" || owes) && (
        <p className="mt-2 whitespace-pre-line text-[11px] text-muted-foreground">
          {w.paymentInstructions ?? "Para pagar tu saldo, coordina la transferencia con administración."}
          {"\n"}Después de pagar, reporta tu pago aquí con la referencia y la foto del comprobante: administración lo confirmará y se descontará de tu saldo.
        </p>
      )}
      <PaymentReportForm
        balance={Math.max(0, w.balance)}
        disabledReason={w.entries.filter((e) => e.entryType === "payment" && e.status === "pending").length >= w.maxPendingPayments ? "Tienes pagos por verificar" : undefined}
      />

      {w.entries.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-extrabold">Últimos movimientos</summary>
          <ul className="mt-2 space-y-1.5">
            {w.entries.slice(0, 10).map((entry) => {
              const isPayment = entry.entryType === "payment";
              return (
                <li key={entry.id} className="flex items-start justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block font-bold">{entry.description}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {timeAgo(entry.createdAt)}
                      {entry.status !== "confirmed" ? ` · ${STATUS_LABEL[entry.status]}` : ""}
                      {entry.paymentReference ? ` · ref. ${entry.paymentReference}` : ""}
                    </span>
                    {entry.status === "rejected" && entry.reviewNote && (
                      <span className="block text-[11px] font-bold text-destructive">Motivo: {entry.reviewNote}</span>
                    )}
                  </span>
                  <span className={`shrink-0 font-extrabold ${entry.status !== "confirmed" ? "text-muted-foreground" : isPayment ? "text-brand-dark" : ""}`}>
                    {isPayment ? "−" : "+"}
                    {money(Math.abs(entry.amount))}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {(settlements.data?.length ?? 0) > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-extrabold">Liquidaciones por período</summary>
          <ul className="mt-2 space-y-1.5">
            {settlements.data!.map((s) => (
              <li key={s.id} className="rounded-xl bg-secondary/60 px-3 py-2">
                <span className="block font-bold">{formatPeriod(s.periodStart, s.periodEnd)}</span>
                <span className="block text-[11px] text-muted-foreground">
                  Inicial {money(s.openingBalance)} · cargos +{money(s.charges)} · pagos −{money(s.payments)}
                  {s.adjustments !== 0 ? ` · ajustes ${s.adjustments > 0 ? "+" : "−"}${money(Math.abs(s.adjustments))}` : ""}
                </span>
                <span className="block text-[11px] font-extrabold">Saldo al cierre: {money(s.closingBalance)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
