import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import { money, timeAgo } from "@/lib/format";

const card = "rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border";
const field = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm";

type WalletType = "courier" | "business";
type EntryType = "charge" | "payment";

export default function AdminFinance() {
  const utils = trpc.useUtils();
  const settings = trpc.admin.financeSettings.useQuery();
  const wallets = trpc.admin.financeWallets.useQuery(undefined, { refetchInterval: 20000 });
  const entries = trpc.admin.financeEntries.useQuery({ status: "pending" }, { refetchInterval: 20000 });
  const saveSettings = trpc.admin.updateFinanceSettings.useMutation({
    onSuccess: () => { toast.success("Configuración financiera guardada"); utils.admin.financeSettings.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const createEntry = trpc.admin.createFinanceEntry.useMutation({
    onSuccess: () => { toast.success("Movimiento registrado"); utils.admin.financeWallets.invalidate(); utils.admin.financeEntries.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const review = trpc.admin.reviewFinancePayment.useMutation({
    onSuccess: () => { toast.success("Pago actualizado"); utils.admin.financeWallets.invalidate(); utils.admin.financeEntries.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const [walletType, setWalletType] = useState<WalletType>("courier");
  const [walletId, setWalletId] = useState("");
  const [entryType, setEntryType] = useState<EntryType>("charge");
  const [amount, setAmount] = useState("0.45");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [fee, setFee] = useState("");
  const [courierLimit, setCourierLimit] = useState("");
  const [businessLimit, setBusinessLimit] = useState("");
  const [baseFee, setBaseFee] = useState("");
  const [perKm, setPerKm] = useState("");
  const [perMinute, setPerMinute] = useState("");
  const [dynamic, setDynamic] = useState(false);

  const activeWallets = useMemo(() => (wallets.data ?? []).filter((w) => w.walletType === walletType), [wallets.data, walletType]);
  const selectedSettings = settings.data;
  // Initialize edit fields from server settings without overwriting user edits on every refresh.
  useEffect(() => {
    if (!selectedSettings) return;
    setFee(String(selectedSettings.serviceFee)); setCourierLimit(String(selectedSettings.courierDebtLimit));
    setBusinessLimit(String(selectedSettings.businessDebtLimit)); setBaseFee(String(selectedSettings.deliveryBaseFee));
    setPerKm(String(selectedSettings.deliveryPerKm)); setPerMinute(String(selectedSettings.deliveryPerMinute));
    setDynamic(selectedSettings.dynamicPricingEnabled);
  }, [selectedSettings?.id]);

  const submitEntry = () => {
    const parsedId = Number(walletId); const parsedAmount = Number(amount);
    if (!Number.isInteger(parsedId) || parsedId <= 0) return toast.error("Selecciona una cuenta válida");
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return toast.error("Ingresa un importe válido");
    if (description.trim().length < 3) return toast.error("Escribe un motivo de al menos 3 caracteres");
    createEntry.mutate({ walletType, walletId: parsedId, entryType, amount: parsedAmount, description: description.trim(), ...(reference.trim() ? { paymentReference: reference.trim() } : {}) });
  };

  return <div className="space-y-4">
    <section className={card}>
      <h2 className="text-lg font-extrabold">Resumen financiero</h2>
      <p className="mb-3 text-xs text-muted-foreground">Cuentas por cobrar calculadas desde movimientos confirmados. No representa dinero recibido por Rescate.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-secondary p-3"><p className="text-xs text-muted-foreground">Saldo repartidores</p><p className="text-xl font-extrabold">{money((wallets.data ?? []).filter(w => w.walletType === "courier").reduce((s,w)=>s+w.balance,0))}</p></div>
        <div className="rounded-xl bg-secondary p-3"><p className="text-xs text-muted-foreground">Saldo negocios</p><p className="text-xl font-extrabold">{money((wallets.data ?? []).filter(w => w.walletType === "business").reduce((s,w)=>s+w.balance,0))}</p></div>
        <div className="rounded-xl bg-secondary p-3"><p className="text-xs text-muted-foreground">Pagos por revisar</p><p className="text-xl font-extrabold">{entries.data?.length ?? 0}</p></div>
      </div>
    </section>

    <section className={card}>
      <h2 className="mb-1 text-lg font-extrabold">Configuración de tarifas</h2>
      <p className="mb-3 text-xs text-muted-foreground">Estos parámetros se guardan para la siguiente fase. El precio dinámico no modifica pedidos todavía.</p>
      {settings.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-muted" /> : <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <label className="text-xs font-bold">Servicio al cliente ($)<input className={`${field} mt-1`} type="number" min="0" step="0.01" value={fee} onChange={e=>setFee(e.target.value)} /></label>
          <label className="text-xs font-bold">Límite repartidor ($)<input className={`${field} mt-1`} type="number" min="0" step="0.5" value={courierLimit} onChange={e=>setCourierLimit(e.target.value)} /></label>
          <label className="text-xs font-bold">Límite negocio ($)<input className={`${field} mt-1`} type="number" min="0" step="0.5" value={businessLimit} onChange={e=>setBusinessLimit(e.target.value)} /></label>
          <label className="text-xs font-bold">Base de envío ($)<input className={`${field} mt-1`} type="number" min="0" step="0.05" value={baseFee} onChange={e=>setBaseFee(e.target.value)} /></label>
          <label className="text-xs font-bold">Precio por km ($)<input className={`${field} mt-1`} type="number" min="0" step="0.01" value={perKm} onChange={e=>setPerKm(e.target.value)} /></label>
          <label className="text-xs font-bold">Precio por minuto ($)<input className={`${field} mt-1`} type="number" min="0" step="0.01" value={perMinute} onChange={e=>setPerMinute(e.target.value)} /></label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={dynamic} onChange={e=>setDynamic(e.target.checked)} /> Habilitar precios dinámicos (solo configuración; no afecta cotizaciones todavía)</label>
        <button disabled={saveSettings.isPending} onClick={()=>{
          const values = [fee,courierLimit,businessLimit,baseFee,perKm,perMinute].map(Number);
          if (values.some(v=>!Number.isFinite(v)||v<0)) return toast.error("Todos los valores deben ser números positivos o cero");
          saveSettings.mutate({serviceFee:values[0],courierDebtLimit:values[1],businessDebtLimit:values[2],deliveryBaseFee:values[3],deliveryPerKm:values[4],deliveryPerMinute:values[5],dynamicPricingEnabled:dynamic});
        }} className="mt-4 rounded-xl bg-brand px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50">Guardar configuración</button>
      </>}
    </section>

    <section className={card}>
      <h2 className="mb-1 text-lg font-extrabold">Registrar movimiento</h2>
      <p className="mb-3 text-xs text-muted-foreground">Los cargos aumentan la deuda. Los pagos quedan pendientes y no reducen el saldo hasta confirmarlos.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-bold">Tipo de cuenta<select className={`${field} mt-1`} value={walletType} onChange={e=>{setWalletType(e.target.value as WalletType);setWalletId("")}}><option value="courier">Repartidor</option><option value="business">Negocio</option></select></label>
        <label className="text-xs font-bold">Movimiento<select className={`${field} mt-1`} value={entryType} onChange={e=>setEntryType(e.target.value as EntryType)}><option value="charge">Cargo / deuda</option><option value="payment">Pago para verificar</option></select></label>
      </div>
      <label className="mt-3 block text-xs font-bold">Cuenta<select className={`${field} mt-1`} value={walletId} onChange={e=>setWalletId(e.target.value)}><option value="">Seleccionar cuenta…</option>{activeWallets.map(w=><option key={w.walletId} value={w.walletId}>#{w.walletId} · {w.name} · saldo {money(w.balance)}</option>)}</select></label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs font-bold">Importe ($)<input className={`${field} mt-1`} type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} /></label>
        <label className="text-xs font-bold">Referencia de pago (opcional)<input className={`${field} mt-1`} value={reference} onChange={e=>setReference(e.target.value)} placeholder="N.º de transferencia" /></label>
      </div>
      <label className="mt-3 block text-xs font-bold">Motivo / detalle<input className={`${field} mt-1`} value={description} onChange={e=>setDescription(e.target.value)} placeholder={entryType === "charge" ? "Tarifa de servicio de pedido…" : "Pago recibido, pendiente de verificar…"} /></label>
      <button disabled={createEntry.isPending} onClick={submitEntry} className="mt-3 rounded-xl bg-brand px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50">Registrar movimiento</button>
    </section>

    <section className={card}>
      <h2 className="mb-3 text-lg font-extrabold">Monederos</h2>
      <div className="mb-3 flex gap-2"><button onClick={()=>setWalletType("courier")} className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${walletType === "courier" ? "bg-foreground text-background" : "bg-secondary"}`}>Repartidores</button><button onClick={()=>setWalletType("business")} className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${walletType === "business" ? "bg-foreground text-background" : "bg-secondary"}`}>Negocios</button></div>
      <div className="space-y-2">{activeWallets.map(w=><article key={`${w.walletType}-${w.walletId}`} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div className="min-w-0"><p className="truncate text-sm font-extrabold">{w.name}</p><p className="text-xs text-muted-foreground">#{w.walletId} · {w.email ?? "sin correo"}{w.pendingPayments ? ` · pagos pendientes ${money(w.pendingPayments)}` : ""}</p></div><div className="text-right"><p className={`font-extrabold ${w.balance>0?"text-amber-700":""}`}>{money(w.balance)}</p><p className="text-[10px] text-muted-foreground">{w.active ? "Cuenta activa" : "No aprobada"}</p></div></article>)}{!wallets.isLoading && activeWallets.length===0 && <p className="text-sm text-muted-foreground">No hay cuentas registradas.</p>}</div>
    </section>

    <section className={card}>
      <h2 className="mb-1 text-lg font-extrabold">Pagos pendientes de revisión</h2>
      <p className="mb-3 text-xs text-muted-foreground">Confirma únicamente después de verificar el ingreso por el canal de pago correspondiente.</p>
      <div className="space-y-2">{(entries.data ?? []).filter(e=>e.entryType === "payment").map(e=><article key={e.id} className="rounded-xl border border-border p-3"><div className="flex justify-between gap-2"><div><p className="text-sm font-extrabold">{e.walletType === "courier" ? "Repartidor" : "Negocio"} #{e.walletId} · {money(e.amount)}</p><p className="text-xs text-muted-foreground">{e.description} · {e.paymentReference ?? "sin referencia"}</p><p className="text-xs text-muted-foreground">{timeAgo(e.createdAt)}</p></div><div className="flex flex-col gap-1"><button disabled={review.isPending} onClick={()=>review.mutate({entryId:e.id,decision:"confirmed"})} className="rounded-lg bg-brand px-2 py-1 text-xs font-bold text-white">Confirmar</button><button disabled={review.isPending} onClick={()=>review.mutate({entryId:e.id,decision:"rejected"})} className="rounded-lg border border-destructive px-2 py-1 text-xs font-bold text-destructive">Rechazar</button></div></div></article>)}{(entries.data ?? []).filter(e=>e.entryType === "payment").length===0 && <p className="text-sm text-muted-foreground">No hay pagos pendientes.</p>}</div>
    </section>
  </div>;
}
