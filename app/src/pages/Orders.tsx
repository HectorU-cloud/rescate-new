import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { money, timeAgo } from "@/lib/format";
import { ORDER_STATUS_LABELS, type OrderStatusKey } from "@contracts/constants";

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

  const active = (mine.data ?? []).filter(
    (r) => !["delivered", "cancelled"].includes(r.order.status),
  );
  const history = (mine.data ?? []).filter((r) =>
    ["delivered", "cancelled"].includes(r.order.status),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="font-display text-2xl font-extrabold">Mis pedidos</h1>

      {mine.data?.length === 0 && (
        <div className="rounded-3xl bg-card p-10 text-center ring-1 ring-border">
          <p className="text-5xl">🧾</p>
          <p className="font-display mt-3 text-lg font-extrabold">
            Aún no has pedido nada
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu historial aparecerá aquí
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-4 rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-white"
          >
            Explorar locales
          </button>
        </div>
      )}

      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
            En curso
          </h2>
          {active.map(({ order, business }) => (
            <OrderRow key={order.id} order={order} businessName={business?.name ?? ""} emoji={business?.emoji ?? "🍽️"} live />
          ))}
        </section>
      )}

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
            Historial
          </h2>
          {history.map(({ order, business }) => (
            <OrderRow key={order.id} order={order} businessName={business?.name ?? ""} emoji={business?.emoji ?? "🍽️"} />
          ))}
        </section>
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
  order: {
    id: number;
    code: string;
    type: string;
    status: string;
    total: number;
    createdAt: Date;
  };
  businessName: string;
  emoji: string;
  live?: boolean;
}) {
  const meta =
    ORDER_STATUS_LABELS[order.status as OrderStatusKey] ??
    ORDER_STATUS_LABELS.pending;
  return (
    <Link
      to={`/pedido/${order.id}`}
      className="flex items-center gap-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border"
    >
      <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-2xl">
        {order.type === "rescue" ? "🧡" : emoji}
        {live && (
          <span className="animate-pulse-dot absolute -right-1 -top-1 h-3 w-3 rounded-full bg-brand" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold">
          {businessName}
          <span className="ml-2 text-xs font-bold text-muted-foreground">
            {order.code}
          </span>
        </p>
        <p className="text-xs font-semibold text-muted-foreground">
          {order.type === "rescue" ? "Rescate" : "Delivery"} · {meta.label} ·{" "}
          {timeAgo(order.createdAt)}
        </p>
      </div>
      <span className="font-display text-sm font-extrabold">
        {money(order.total)}
      </span>
    </Link>
  );
}
