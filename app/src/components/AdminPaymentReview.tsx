import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { money, timeAgo } from "@/lib/format";

const card = "rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border";

/** Pagos reportados por repartidores y comercios: comprobante a la vista junto a confirmar o rechazar. */
export default function AdminPaymentReview() {
  const utils = trpc.useUtils();
  const entries = trpc.admin.financeEntries.useQuery({ status: "pending" }, { refetchInterval: 20000 });
  const wallets = trpc.admin.financeWallets.useQuery();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const review = trpc.admin.reviewFinancePayment.useMutation({
    onSuccess: () => { toast.success("Pago actualizado"); utils.admin.financeWallets.invalidate(); utils.admin.financeEntries.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const payments = (entries.data ?? []).filter((e) => e.entryType === "payment");
  const balanceOf = (type: string, id: number) => wallets.data?.find((w) => w.walletType === type && w.walletId === Number(id))?.balance;

  return (
    <section className={card}>
      <h2 className="mb-1 text-lg font-extrabold">Pagos pendientes de revisión</h2>
      <p className="mb-3 text-xs text-muted-foreground">Compara el comprobante con el ingreso real por el canal de pago antes de confirmar. Si rechazas, la persona verá tu motivo.</p>
      <div className="space-y-3">
        {payments.map((e) => {
          const debt = balanceOf(e.walletType, Number(e.walletId));
          const note = notes[e.id] ?? "";
          return (
            <article key={e.id} className="rounded-xl border border-border p-3">
              <div className="flex gap-3">
                {e.proofUrl ? (
                  <a href={e.proofUrl} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label="Ver comprobante completo">
                    <img src={e.proofUrl} alt="Comprobante de pago" loading="lazy" className="h-24 w-24 rounded-lg object-cover ring-1 ring-border" />
                  </a>
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-secondary px-2 text-center text-[11px] font-bold text-muted-foreground">Sin comprobante</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold">{e.walletName} · {money(e.amount)}</p>
                  <p className="text-xs text-muted-foreground">{e.walletType === "courier" ? "Repartidor" : "Negocio"} #{e.walletId}{debt !== undefined ? ` · debe ${money(debt)}` : ""}</p>
                  <p className="break-words text-xs text-muted-foreground">Ref.: <b>{e.paymentReference ?? "sin referencia"}</b></p>
                  <p className="break-words text-xs text-muted-foreground">{e.description} · {timeAgo(e.createdAt)}</p>
                </div>
              </div>
              <input
                value={note}
                maxLength={300}
                onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))}
                placeholder="Motivo (obligatorio para rechazar)"
                className="mt-3 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
              />
              <div className="mt-2 flex gap-2">
                <button disabled={review.isPending} onClick={() => review.mutate({ entryId: e.id, decision: "confirmed", ...(note.trim() ? { note: note.trim() } : {}) })} className="flex-1 rounded-lg bg-brand px-2 py-2 text-xs font-bold text-white disabled:opacity-50">Confirmar</button>
                <button
                  disabled={review.isPending}
                  onClick={() => (note.trim().length < 3 ? toast.error("Escribe el motivo del rechazo") : review.mutate({ entryId: e.id, decision: "rejected", note: note.trim() }))}
                  className="flex-1 rounded-lg border border-destructive px-2 py-2 text-xs font-bold text-destructive disabled:opacity-50"
                >
                  Rechazar
                </button>
              </div>
            </article>
          );
        })}
        {!entries.isLoading && payments.length === 0 && <p className="text-sm text-muted-foreground">No hay pagos pendientes.</p>}
      </div>
    </section>
  );
}
