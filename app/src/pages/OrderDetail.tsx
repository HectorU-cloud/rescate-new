import { useDialogs } from "@/providers/dialogs";
import { StaticMap } from "@/components/StaticMap";
import { useParams, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { LOGIN_PATH } from "@/const";
import { StatusTimeline } from "@/components/StatusTimeline";
import { ChatBox } from "@/components/ChatBox";
import { ClaimBox } from "@/components/ClaimBox";
import { RatingBox } from "@/components/RatingBox";
import { CodeNotice } from "@/components/CodeNotice";
import { money, timeAgo } from "@/lib/format";
import { DELIVERY_FLOW, MILAGRO, ORDER_STATUS_LABELS, RESCUE_FLOW, type OrderStatusKey } from "@contracts/constants";
import { toast } from "sonner";

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { add } = useCart();
  const orderId = Number(id);
  const { user, isAuthenticated } = useAuth({
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
  // Se consulta únicamente cuando el usuario solicita repetir un pedido.
  const repeatCatalog = trpc.catalog.businessDetail.useQuery(
    { id: detail.data?.order.businessId ?? 1 },
    { enabled: false, retry: false },
  );
  const liveLocation = trpc.orders.liveLocation.useQuery(
    { id: orderId },
    {
      enabled: isAuthenticated && Number.isFinite(orderId),
      refetchInterval: 8_000,
    },
  );
  const dialogs = useDialogs();
  const cancel = trpc.orders.cancel.useMutation({
    onSuccess: () => {
      toast.success("Pedido cancelado");
      utils.orders.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const regenerate = trpc.orders.regenerateCode.useMutation({
    onSuccess: () => {
      toast.success("Código nuevo generado");
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

  const { order, items, business, courier } = detail.data;
  // Punto que muestra el mapa: el GPS del repartidor si está fresco; si no, el local.
  const live = liveLocation.data && !liveLocation.data.stale ? liveLocation.data : null;
  const mapPoint = live
    ? { lat: live.lat, lng: live.lng, live: true }
    : { lat: business?.lat ?? MILAGRO.lat, lng: business?.lng ?? MILAGRO.lng, live: false };
  const isActive = !["delivered", "cancelled"].includes(order.status);
  const orderFlow = order.type === "delivery" ? DELIVERY_FLOW : RESCUE_FLOW;
  const currentStep = orderFlow.indexOf(order.status as OrderStatusKey);
  const statusMeta = ORDER_STATUS_LABELS[order.status as OrderStatusKey] ?? ORDER_STATUS_LABELS.pending;
  const statusDescription = order.status === "delivered"
    ? "¡Gracias por rescatar alimentos! Esperamos que disfrutes tu pedido."
    : order.status === "cancelled"
      ? "Este pedido ya no está en curso. Puedes revisar el detalle a continuación."
      : order.status === "picked_up"
        ? order.fulfillmentMethod === "pickup" ? "El pedido está listo para retirar en el local." : "Tu pedido está en camino. Puedes consultar la ubicación más abajo."
        : order.status === "ready"
          ? order.type === "delivery" ? (order.fulfillmentMethod === "pickup" ? "Tu pedido está listo para que lo retires en el local." : "Tu pedido está listo y pronto saldrá hacia tu dirección.") : "Tu rescate está listo para retirar en el local."
          : order.status === "preparing"
            ? "El local está preparando tu pedido con cuidado."
            : order.status === "accepted"
              ? "El local confirmó tu pedido. Te mostraremos aquí cada actualización."
              : "Estamos esperando la confirmación del local.";

  const repeatOrder = async () => {
    if (order.type !== "delivery") {
      toast.info("La repetición automática está disponible para pedidos a domicilio.");
      return;
    }
    try {
      const result = await repeatCatalog.refetch();
      const catalog = result.data;
      if (!catalog?.business?.openNow) {
        toast.error("Este local está cerrado. Intenta repetir el pedido cuando abra.");
        return;
      }
      const available = new Map(
        (catalog.products ?? []).filter((product) => product.isAvailable).map((product) => [product.id, product]),
      );
      const repeatable = items.flatMap((item) => {
        const product = item.productId == null ? undefined : available.get(item.productId);
        return product ? [{ product, quantity: item.quantity }] : [];
      });
      if (repeatable.length === 0) {
        toast.error("Ningún producto de este pedido sigue disponible.");
        return;
      }
      repeatable.forEach(({ product, quantity }) => {
        for (let count = 0; count < Math.min(quantity, 50); count += 1) {
          add(
            { id: catalog.business.id, name: catalog.business.name, deliveryFee: catalog.business.deliveryFee },
            { productId: product.id, name: product.name, price: product.price, emoji: product.emoji },
          );
        }
      });
      const skipped = items.length - repeatable.length;
      toast.success(
        skipped > 0
          ? `Pedido preparado. ${skipped} producto(s) agotado(s) se omitieron.`
          : "Pedido anterior añadido al carrito.",
      );
      navigate("/carrito");
    } catch {
      toast.error("No se pudo consultar la disponibilidad. Inténtalo de nuevo.");
    }
  };

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

      {/* Resumen visual del estado */}
      <section className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border">
        <div className={`p-5 ${order.status === "cancelled" ? "bg-destructive/10" : order.status === "delivered" ? "bg-brand-soft" : "bg-gradient-to-r from-brand-soft via-card to-card"}`}>
          <div className="flex items-start gap-3">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl ${order.status === "cancelled" ? "bg-destructive/10" : "bg-card shadow-sm"}`}>
              {order.status === "delivered" ? "✅" : order.status === "cancelled" ? "✕" : order.status === "picked_up" ? "🛵" : order.status === "ready" ? "📦" : order.status === "preparing" ? "👨‍🍳" : "🧾"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">{isActive ? "Seguimiento en vivo" : "Resumen del pedido"}</p>
              <h2 className="mt-1 font-display text-xl font-extrabold">{statusMeta.label}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{statusDescription}</p>
            </div>
            {isActive && <span className="mt-1 flex h-3 w-3 shrink-0 rounded-full bg-brand ring-4 ring-brand/10 animate-pulse-dot" />}
          </div>
          {order.status !== "cancelled" && (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                <span>Progreso del pedido</span>
                <span>{currentStep >= 0 ? `${currentStep + 1} de ${orderFlow.length}` : "En proceso"}</span>
              </div>
              <div className="flex gap-1.5" aria-label={`Progreso: ${statusMeta.label}`}>
                {orderFlow.map((step, index) => (
                  <span key={step} className={`h-1.5 flex-1 rounded-full ${index <= currentStep ? "bg-brand" : "bg-border"}`} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Quién lleva (o llevó) el pedido */}
      {order.type === "delivery" && order.fulfillmentMethod === "delivery" && courier && order.customerId === user?.id && (
        <section className="flex items-center gap-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
          {courier.photoUrl ? (
            <img src={courier.photoUrl} alt={`Foto de ${courier.name ?? "tu repartidor"}`} className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-secondary text-3xl">🛵</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
              {order.status === "delivered" ? "Te entregó" : "Tu repartidor"}
            </p>
            <p className="font-display truncate text-lg font-extrabold">{courier.name ?? "Repartidor"}</p>
            <p className="text-xs font-bold text-muted-foreground">
              {courier.vehicle ? `🏍️ ${courier.vehicle}` : "🏍️ Vehículo no indicado"}
              {courier.plate ? ` · Placa ${courier.plate}` : ""}
            </p>
            <p className="text-xs font-bold text-muted-foreground">
              {courier.rating != null ? `⭐ ${courier.rating.toFixed(1)} (${courier.ratingCount})` : "⭐ Aún sin calificaciones"}
            </p>
          </div>
        </section>
      )}

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
          <CodeNotice attempts={order.codeAttempts} pending={regenerate.isPending} onRegenerate={() => regenerate.mutate({ id: order.id })} />
        </section>
      )}

      {order.type === "delivery" && order.fulfillmentMethod === "delivery" && order.status === "picked_up" && order.deliveryConfirmationCode && (
        <section className="rounded-3xl bg-brand-soft p-5 text-center ring-1 ring-brand/20">
          <p className="text-xs font-extrabold uppercase tracking-wide text-brand-dark">Código para confirmar tu entrega</p>
          <p className="font-display mt-2 text-4xl font-extrabold tracking-[0.3em] text-brand-dark">{order.deliveryConfirmationCode}</p>
          <p className="mt-2 text-xs font-semibold text-brand-dark/80">Compártelo con el repartidor únicamente cuando recibas tu pedido. No lo envíes por el chat antes de la entrega.</p>
          <CodeNotice attempts={order.codeAttempts} pending={regenerate.isPending} onRegenerate={() => regenerate.mutate({ id: order.id })} />
        </section>
      )}

      {/* Línea de tiempo */}
      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-display text-base font-extrabold">Etapas del pedido</h2><span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">{order.type === "delivery" ? (order.fulfillmentMethod === "pickup" ? "Retiro en local" : "A domicilio") : "Retiro en local"}</span></div>
        <StatusTimeline type={order.type} status={order.status} fulfillmentMethod={order.fulfillmentMethod ?? "delivery"} />
        {order.type === "delivery" && order.fulfillmentMethod === "delivery" && order.status === "picked_up" && liveLocation.data && !liveLocation.data.stale && (
          <div className="mt-4 rounded-2xl bg-brand-soft p-4 ring-1 ring-brand/20">
            <p className="text-sm font-extrabold text-brand-dark">🛵 Seguimiento del repartidor</p>
            {liveLocation.data.etaMinutes != null ? (
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="font-display text-2xl font-extrabold text-brand-dark">{liveLocation.data.etaMinutes <= 1 ? "Llegando" : `~${liveLocation.data.etaMinutes} min`}</p>
                  <p className="text-xs font-semibold text-brand-dark/80">Tiempo estimado de llegada</p>
                </div>
                {liveLocation.data.remainingDistanceKm != null && (
                  <p className="text-xs font-bold text-brand-dark">Aprox. {liveLocation.data.remainingDistanceKm.toFixed(1)} km</p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs font-semibold text-brand-dark/80">GPS recibido. Para estimar la llegada, el cliente debe compartir su ubicación al realizar el pedido.</p>
            )}
            <p className="mt-2 text-[11px] text-brand-dark/70">Estimación orientativa basada en distancia geográfica; el tráfico y la ruta real pueden cambiar el tiempo.</p>
          </div>
        )}
        {order.type === "delivery" && order.estimatedReadyAt && ["accepted", "preparing"].includes(order.status) && (
          <p className="mt-4 rounded-2xl bg-brand-soft px-4 py-3 text-sm font-bold text-brand-dark">
            ⏱️ El local estima tenerlo listo a las {new Date(order.estimatedReadyAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}
            {order.prepMinutes ? ` (unos ${order.prepMinutes} min)` : ""}.
          </p>
        )}
        {order.type === "delivery" && order.fulfillmentMethod === "delivery" &&
          ["ready", "picked_up"].includes(order.status) && (
            <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-border">
              <StaticMap
                lat={mapPoint.lat}
                lng={mapPoint.lng}
                emoji={mapPoint.live ? "🛵" : "🏪"}
                label={mapPoint.live ? "Ubicación GPS del repartidor y destino" : "Local y destino del pedido"}
                destinationLat={order.deliveryLat}
                destinationLng={order.deliveryLng}
                className="h-56 w-full sm:h-64"
              />
              <p className="bg-secondary px-3 py-2 text-[11px] font-bold text-muted-foreground">
                {liveLocation.data && !liveLocation.data.stale
                  ? `🛵 GPS del repartidor actualizado ${new Date(liveLocation.data.updatedAt).toLocaleTimeString()}. El mapa se refresca automáticamente.`
                  : liveLocation.data?.stale
                    ? "⚠️ La última ubicación está desactualizada. Mostramos el local hasta recibir una nueva señal GPS."
                    : "📍 Mostramos el local. La ubicación del repartidor aparecerá cuando active el GPS durante la entrega."}
              </p>
              <p className="bg-secondary/60 px-3 py-2 text-[10px] text-muted-foreground">
                La línea punteada es una referencia visual entre el origen y el destino; no representa todavía una ruta por calles.
              </p>
            </div>
          )}
      </section>

      {/* Chat con el repartidor (en camino; luego queda como historial si hubo mensajes) */}
      {order.type === "delivery" && !!order.courierId && order.customerId === user?.id && ["picked_up", "delivered"].includes(order.status) && (
        <ChatBox orderId={order.id} />
      )}

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
          onClick={() => {
            void dialogs.confirm({ title: "¿Seguro que quieres cancelar este pedido?", confirmLabel: "Sí, cancelar" }).then((ok) => { if (ok) cancel.mutate({ id: order.id }); });
          }}
          disabled={cancel.isPending}
          className="w-full rounded-2xl bg-card py-3.5 text-sm font-extrabold text-destructive ring-1 ring-border"
        >
          Cancelar pedido
        </button>
      )}
      {["preparing", "ready", "picked_up"].includes(order.status) && order.customerId === user?.id && (
        <p className="rounded-2xl bg-secondary px-4 py-3 text-xs font-bold text-muted-foreground">
          Ya no se puede cancelar: el local empezó a preparar tu pedido. Si hay un problema, envía un reclamo abajo.
        </p>
      )}
      {order.cancelledBy && order.status === "cancelled" && (
        <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-xs font-bold text-destructive">
          Cancelado {order.cancelledBy === "customer" ? "por ti" : order.cancelledBy === "business" ? "por el local" : order.cancelledBy === "admin" ? "por soporte" : "automáticamente"}
          {order.cancelReason ? `: ${order.cancelReason}` : "."}
        </p>
      )}
      {order.customerId === user?.id && order.type === "delivery" && order.status === "delivered" && (
        <button
          type="button"
          onClick={repeatOrder}
          disabled={repeatCatalog.isFetching}
          className="w-full rounded-2xl bg-brand py-3.5 text-sm font-extrabold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
        >
          {repeatCatalog.isFetching ? "Comprobando disponibilidad…" : "↻ Repetir pedido"}
        </button>
      )}
      {order.customerId === user?.id && order.status === "delivered" && (
        <RatingBox orderId={order.id} businessName={business?.name} hasCourier={!!order.courierId} />
      )}
      {order.customerId === user?.id && !["pending", "accepted"].includes(order.status) && (
        <ClaimBox orderId={order.id} role="customer" />
      )}
    </div>
  );
}
