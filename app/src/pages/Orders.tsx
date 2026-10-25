import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { money, timeAgo } from "@/lib/format";
import { ORDER_STATUS_LABELS, type OrderStatusKey } from "@contracts/constants";
import { ArrowRight, Clock3, PackageCheck, RefreshCw, ShoppingBag } from "lucide-react";

export default function Orders() {
  const { isAuthenticated, isLoading } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const navigate = useNavigate();
  const mine = trpc.orders.mine.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 15_000,
  });

  if (isLoading) return null;

  const orders = mine.data ?? [];
  const active = orders.filter((r) => !["delivered", "cancelled"].includes(r.order.status));
  const history = orders.filter((r) => ["delivered", "cancelled"].includes(r.order.status));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="overflow-hidden rounded-3xl bg-foreground p-5 text-white sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/60">Al Rescate · Tu cuenta</p>
            <h1 className="font-display mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Mis pedidos</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/75">Consulta el estado de tus compras y vuelve a revisar los pedidos que ya recibiste.</p>
          </div>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 sm:h-14 sm:w-14"><ShoppingBag className="h-6 w-6 sm:h-7 sm:w-7" /></span>
        </div>
        {!mine.isLoading && !mine.isError && orders.length > 0 && (
          <div className="mt-5 grid grid-cols-2 gap-2 sm:max-w-sm">
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-xs font-semibold text-white/65">En curso</p>
              <p className="mt-1 text-2xl font-extrabold">{active.length}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-xs font-semibold text-white/65">Finalizados</p>
              <p className="mt-1 text-2xl font-extrabold">{history.length}</p>
            </div>
          </div>
        )}
      </header>

      {mine.isLoading && (
        <div className="space-y-3" aria-label="Cargando pedidos" aria-live="polite">
          {[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-3xl bg-card ring-1 ring-border" />)}
        </div>
      )}

      {mine.isError && (
        <div className="rounded-3xl bg-card p-6 text-center ring-1 ring-border sm:p-8">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-secondary"><RefreshCw className="h-5 w-5" /></span>
          <h2 className="mt-3 font-display text-lg font-extrabold">No pudimos cargar tus pedidos</h2>
          <p className="mt-1 text-sm text-muted-foreground">Revisa tu conexión e inténtalo nuevamente.</p>
          <button type="button" onClick={() => void mine.refetch()} className="mt-4 rounded-full bg-brand px-5 py-3 text-sm font-extrabold text-white">Volver a intentar</button>
        </div>
      )}

      {!mine.isLoading && !mine.isError && orders.length === 0 && (
        <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border sm:p-10">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-brand-soft text-brand"><ShoppingBag className="h-8 w-8" /></span>
          <h2 className="font-display mt-4 text-xl font-extrabold">Aún no has pedido nada</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Cuando hagas tu primera compra, podrás seguir su estado y consultar aquí el historial.</p>
          <button onClick={() => navigate("/")} className="mt-5 rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-white">Explorar locales</button>
        </div>
      )}

      {active.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-soft text-brand"><Clock3 className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-extrabold">En curso</h2>
              <p className="text-xs text-muted-foreground">Actualizamos el estado automáticamente</p>
            </div>
            <span className="ml-auto rounded-full bg-brand-soft px-3 py-1 text-xs font-extrabold text-brand-dark">{active.length}</span>
          </div>
          <div className="space-y-3">
            {active.map(({ order, business }) => <OrderRow key={order.id} order={order} businessName={business?.name ?? "Local Al Rescate"} emoji={business?.emoji ?? "🍽️"} live />)}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-secondary"><PackageCheck className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-extrabold">Historial</h2>
              <p className="text-xs text-muted-foreground">Tus pedidos anteriores</p>
            </div>
            <span className="ml-auto rounded-full bg-secondary px-3 py-1 text-xs font-extrabold">{history.length}</span>
          </div>
          <div className="space-y-3">
            {history.map(({ order, business }) => <OrderRow key={order.id} order={order} businessName={business?.name ?? "Local Al Rescate"} emoji={business?.emoji ?? "🍽️"} />)}
          </div>
        </section>
      )}
      {!mine.isLoading && !mine.isError && orders.length > 0 && (
        <p className="flex items-center justify-center gap-2 px-3 text-center text-xs text-muted-foreground"><RefreshCw className="h-3 w-3" /> El estado se actualiza automáticamente mientras consultas esta página.</p>
      )}
    </div>
  );
}

function OrderRow({
  order,
  businessName,
  emoji,
  live = false,
}: {
  order: { id: number; code: string; type: string; status: string; total: number; createdAt: Date };
  businessName: string;
  emoji: string;
  live?: boolean;
}) {
  const meta = ORDER_STATUS_LABELS[order.status as OrderStatusKey] ?? ORDER_STATUS_LABELS.pending;
  const cancelled = order.status === "cancelled";
  const delivered = order.status === "delivered";
  const statusStyle = cancelled
    ? "bg-destructive/10 text-destructive"
    : delivered
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "bg-brand-soft text-brand-dark";

  return (
    <Link to={`/pedido/${order.id}`} className="group flex min-w-0 items-center gap-3 rounded-3xl bg-card p-3 shadow-sm ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:gap-4 sm:p-4">
      <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-secondary text-2xl sm:h-14 sm:w-14">
        {order.type === "rescue" ? "🧡" : emoji}
        {live && <span className="animate-pulse-dot absolute -right-1 -top-1 h-3 w-3 rounded-full bg-brand ring-2 ring-card" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold sm:text-base">{businessName}</p>
        <p className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground sm:text-xs">Pedido {order.code} · {order.type === "rescue" ? "Rescate" : "Delivery"}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold sm:text-xs ${statusStyle}`}>{meta.label}</span>
          <span className="text-[10px] font-medium text-muted-foreground sm:text-xs">{timeAgo(order.createdAt)}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="font-display text-sm font-extrabold sm:text-base">{money(order.total)}</span>
        <span className="flex items-center gap-1 text-[10px] font-extrabold text-brand sm:text-xs">Ver pedido <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span>
      </div>
    </Link>
  );
}
