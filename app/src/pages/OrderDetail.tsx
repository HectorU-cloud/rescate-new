import { useState } from "react";
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
  const [chatText, setChatText] = useState("");
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
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
  const chat = trpc.orders.chatMessages.useQuery({ id: orderId }, { enabled: isAuthenticated && Number.isFinite(orderId), refetchInterval: 4000, retry: false });
  const sendMessage = trpc.orders.sendChatMessage.useMutation({ onSuccess: () => { setChatText(""); utils.orders.chatMessages.invalidate({ id: orderId }); }, onError: (e) => toast.error(e.message) });
  const sendReview = trpc.courier.reviewCourier.useMutation({ onSuccess: () => { toast.success("¡Gracias por valorar la entrega!"); utils.orders.invalidate(); }, onError: (e) => toast.error(e.message) });
  const liveLocation = trpc.orders.liveLocation.useQuery(
    { id: orderId },
    {
      enabled: isAuthenticated && Number.isFinite(orderId),
      refetchInterval: 8_000,
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

      {order.type === "delivery" && detail.data.courier && (
        <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border space-y-3">
          <h2 className="font-display text-base font-extrabold">Tu repartidor</h2>
          <div className="flex items-center gap-3">
            {detail.data.courier.photoUrl ? <img src={detail.data.courier.photoUrl} alt={`Foto de ${detail.data.courier.name ?? "tu repartidor"}`} className="h-16 w-16 rounded-2xl object-cover" /> : <span className="grid h-16 w-16 place-items-center rounded-2xl bg-secondary text-2xl">🛵</span>}
            <div className="min-w-0 flex-1">
              <p className="font-extrabold">{detail.data.courier.name ?? "Repartidor de Rescate"}</p>
              <p className="text-xs text-muted-foreground">{detail.data.courier.vehicle ?? "Vehículo no especificado"}{detail.data.courier.plate ? ` · ${detail.data.courier.plate}` : ""}</p>
              <p className="text-xs font-semibold text-brand-dark">{detail.data.courier.verificationStatus === "approved" ? "✓ Identidad revisada por Rescate" : "Perfil en revisión"} · {detail.data.courier.deliveries} entregas · {detail.data.courier.reviewCount ? `${detail.data.courier.rating.toFixed(1)} ★ (${detail.data.courier.reviewCount})` : "Sin valoraciones"}</p>
            </div>
          </div>
          {detail.data.courier.bio && <p className="text-sm text-muted-foreground">{detail.data.courier.bio}</p>}
        </section>
      )}

      {/* Línea de tiempo */}
      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <h2 className="font-display mb-4 text-base font-extrabold">
          Estado del pedido
        </h2>
        <StatusTimeline type={order.type} status={order.status} />
        {order.type === "delivery" &&
          ["ready", "assigned", "arrived", "picked_up"].includes(order.status) && (
            <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-border">
              <iframe
                title={liveLocation.data && !liveLocation.data.stale ? "Ubicación GPS del repartidor" : "Mapa del local"}
                className="h-48 w-full"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${(liveLocation.data && !liveLocation.data.stale ? liveLocation.data.lng : business?.lng ?? MILAGRO.lng) - 0.015}%2C${(liveLocation.data && !liveLocation.data.stale ? liveLocation.data.lat : business?.lat ?? MILAGRO.lat) - 0.012}%2C${(liveLocation.data && !liveLocation.data.stale ? liveLocation.data.lng : business?.lng ?? MILAGRO.lng) + 0.015}%2C${(liveLocation.data && !liveLocation.data.stale ? liveLocation.data.lat : business?.lat ?? MILAGRO.lat) + 0.012}&layer=mapnik&marker=${liveLocation.data && !liveLocation.data.stale ? liveLocation.data.lat : business?.lat ?? MILAGRO.lat}%2C${liveLocation.data && !liveLocation.data.stale ? liveLocation.data.lng : business?.lng ?? MILAGRO.lng}`}
              />
              <p className="bg-secondary px-3 py-2 text-[11px] font-bold text-muted-foreground">
                {liveLocation.data && !liveLocation.data.stale
                  ? `🛵 GPS del repartidor actualizado ${new Date(liveLocation.data.updatedAt).toLocaleTimeString()}. El mapa se refresca automáticamente.`
                  : liveLocation.data?.stale
                    ? "⚠️ La última ubicación está desactualizada. Mostramos el local hasta recibir una nueva señal GPS."
                    : "📍 Mostramos el local. La ubicación del repartidor aparecerá cuando active el GPS durante la entrega."}
              </p>
            </div>
          )}
      </section>

      {order.type === "delivery" && order.courierId && isActive && (
        <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border space-y-3">
          <div><h2 className="font-display text-base font-extrabold">Mensajes de entrega</h2><p className="text-xs text-muted-foreground">Comunícate con tu repartidor desde Rescate; evita compartir datos sensibles.</p></div>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl bg-secondary/50 p-3">
            {(chat.data ?? []).length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Aún no hay mensajes. Puedes escribirle si necesitas coordinar la entrega.</p> : (chat.data ?? []).map((m) => <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "bg-brand text-white" : "bg-card ring-1 ring-border"}`}><p>{m.body}</p><p className={`mt-1 text-[10px] ${m.mine ? "text-white/70" : "text-muted-foreground"}`}>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div></div>)}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (chatText.trim()) sendMessage.mutate({ id: order.id, body: chatText.trim() }); }}>
            <input value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={1000} placeholder="Escribe un mensaje…" className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm" />
            <button disabled={!chatText.trim() || sendMessage.isPending} className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Enviar</button>
          </form>
        </section>
      )}

      {order.type === "delivery" && order.status === "delivered" && order.courierId && (
        <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border space-y-3">
          <h2 className="font-display text-base font-extrabold">¿Cómo fue la entrega?</h2>
          <p className="text-sm text-muted-foreground">Tu opinión ayuda a que Rescate sea una comunidad más confiable.</p>
          <div className="flex gap-2" aria-label="Calificación de una a cinco estrellas">{[1,2,3,4,5].map((n) => <button key={n} type="button" onClick={() => setRating(n)} className={`text-2xl ${n <= rating ? "text-amber-500" : "text-muted-foreground"}`} aria-label={`${n} estrellas`}>★</button>)}</div>
          <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} maxLength={500} placeholder="Comentario opcional" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
          <button disabled={sendReview.isPending} onClick={() => sendReview.mutate({ orderId: order.id, rating, comment: reviewText || undefined })} className="w-full rounded-xl bg-brand py-3 text-sm font-extrabold text-white disabled:opacity-50">Enviar valoración</button>
        </section>
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
