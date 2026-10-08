import { useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { StatusTimeline } from "@/components/StatusTimeline";
import { money, timeAgo } from "@/lib/format";
import { MILAGRO } from "@contracts/constants";
import { toast } from "sonner";

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number(id);
  const { isAuthenticated } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const utils = trpc.useUtils();
  const detail = trpc.orders.byId.useQuery(
    { id: orderId },
    {
      enabled: isAuthenticated && Number.isFinite(orderId),
      refetchInterval: (q) =>
        ["delivered", "cancelled"].includes(q.state.data?.order.status ?? "")
          ? false
          : 8_000,
    },
  );
  const cancel = trpc.orders.cancel.useMutation({
    onSuccess: () => {
      toast.success("Pedido cancelado");
      utils.orders.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="h-28 animate-pulse rounded-3xl bg-muted" />
        <div className="h-64 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }
  if (!detail.data) {
    return (
      <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">
        <p className="text-4xl">🔍</p>
        <p className="mt-2 font-display font-bold">
          No encontramos este pedido
        </p>
      </div>
    );
  }

  const { order, items, business } = detail.data;
  const isActive = !["delivered", "cancelled"].includes(order.status);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Encabezado */}
      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-3xl">
            {order.type === "rescue" ? "🧡" : business?.emoji ?? "🍽️"}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-xl font-extrabold">
              {business?.name ?? "Pedido"}
            </h1>
            <p className="text-xs font-bold text-muted-foreground">
              {order.code} · {order.type === "rescue" ? "Rescate" : "Delivery"} ·{" "}
              {timeAgo(order.createdAt)}
            </p>
          </div>
          <span className="font-display text-xl font-extrabold">
            {money(order.total)}
          </span>
        </div>
        {isActive && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-2 text-xs font-extrabold text-brand-dark">
            <span className="animate-pulse-dot h-2 w-2 rounded-full bg-brand" />
            Se actualiza solo, no necesitas recargar
          </p>
        )}
      </section>

      {/* Código de retiro (rescate) */}
      {order.type === "rescue" && order.pickupCode && !["delivered", "cancelled"].includes(order.status) && (
        <section className="rounded-3xl bg-rescue-soft p-5 text-center ring-1 ring-rescue/20">
          <p className="text-xs font-extrabold uppercase tracking-wide text-rescue-dark">
            Muestra este código al retirar
          </p>
          <p className="font-display mt-1 text-4xl font-extrabold tracking-[0.3em] text-rescue-dark">
            {order.pickupCode}
          </p>
          <p className="mt-1 text-xs font-semibold text-rescue-dark/70">
            Pagas en efectivo en el local · {business?.address}
          </p>
        </section>
      )}

      {/* Línea de tiempo */}
      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <h2 className="font-display mb-4 text-base font-extrabold">
          Estado del pedido
        </h2>
        <StatusTimeline type={order.type} status={order.status} />
        {order.type === "delivery" &&
          ["ready", "picked_up"].includes(order.status) && (
            <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-border">
              <iframe
                title="Mapa de Milagro"
                className="h-48 w-full"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${MILAGRO.lng - 0.02}%2C${MILAGRO.lat - 0.015}%2C${MILAGRO.lng + 0.02}%2C${MILAGRO.lat + 0.015}&layer=mapnik&marker=${business?.lat ?? MILAGRO.lat}%2C${business?.lng ?? MILAGRO.lng}`}
              />
              <p className="bg-secondary px-3 py-2 text-[11px] font-bold text-muted-foreground">
                📍 El punto marca el local. El seguimiento GPS del repartidor en
                vivo llega en la siguiente versión.
              </p>
            </div>
          )}
      </section>

      {/* Detalle */}
      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <h2 className="font-display mb-3 text-base font-extrabold">Detalle</h2>
        <ul className="space-y-2 text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex justify-between font-semibold">
              <span>
                {it.quantity} × {it.name}
              </span>
              <span>{money(it.unitPrice * it.quantity)}</span>
            </li>
          ))}
          {order.deliveryFee > 0 && (
            <li className="flex justify-between text-muted-foreground">
              <span>Envío</span>
              <span>{money(order.deliveryFee)}</span>
            </li>
          )}
          <li className="flex justify-between border-t border-border pt-2 font-display text-base font-extrabold">
            <span>Total</span>
            <span>{money(order.total)}</span>
          </li>
        </ul>
        {order.deliveryAddress && (
          <p className="mt-3 rounded-xl bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground">
            📍 {order.deliveryAddress}
          </p>
        )}
        <p className="mt-2 text-xs font-bold text-muted-foreground">
          💵 Pago en efectivo {order.type === "rescue" ? "al retirar" : "al recibir"}
        </p>
      </section>

      {["pending", "accepted"].includes(order.status) && (
        <button
          onClick={() => cancel.mutate({ id: order.id })}
          disabled={cancel.isPending}
          className="w-full rounded-2xl bg-card py-3.5 text-sm font-extrabold text-destructive ring-1 ring-border"
        >
          Cancelar pedido
        </button>
      )}
    </div>
  );
}
