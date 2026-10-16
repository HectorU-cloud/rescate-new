import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { money, timeAgo, withinMinutes } from "@/lib/format";
import { toast } from "sonner";
import { BUSINESS_RULES } from "@contracts/constants";
import { ChatBox } from "@/components/ChatBox";
import { ClaimBox } from "@/components/ClaimBox";

const isLocked = (attempts: number) => attempts >= BUSINESS_RULES.maxCodeAttempts;

export default function CourierPanel() {
  const { user, isAuthenticated } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const utils = trpc.useUtils();
  const [confirmationCodes, setConfirmationCodes] = useState<Record<number, string>>({});
  const enabled = isAuthenticated && user?.appRole === "courier";
  const available = trpc.courier.available.useQuery(undefined, {
    enabled,
    refetchInterval: 10_000,
  });
  const mine = trpc.courier.myDeliveries.useQuery(undefined, {
    enabled,
    refetchInterval: 10_000,
  });
  const earnings = trpc.courier.earnings.useQuery(undefined, { enabled });
  const locationUpdate = trpc.courier.updateLocation.useMutation();
  const activeOrderIds = (mine.data ?? []).filter((d) => d.order.status === "picked_up").map((d) => d.order.id);
  const activeOrderKey = activeOrderIds.join(",");

  useEffect(() => {
    if (!enabled || activeOrderIds.length === 0 || !navigator.geolocation) return;
    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - lastSent < 8000) return;
        lastSent = now;
        for (const orderId of activeOrderIds) {
          locationUpdate.mutate({
            orderId,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) toast.error("Activa el permiso de ubicación para compartir tu GPS");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
    // Rebuild the GPS watcher when active deliveries change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeOrderKey]);
  const accept = trpc.courier.accept.useMutation({
    onSuccess: () => {
      toast.success("¡Pedido tuyo! Ve por él al local");
      utils.courier.invalidate();
      utils.orders.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const availability = trpc.courier.availability.useQuery(undefined, { enabled });
  const setAvailability = trpc.courier.setAvailability.useMutation({
    onSuccess: () => utils.courier.availability.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const release = trpc.courier.release.useMutation({
    onSuccess: () => {
      toast.success("Pedido liberado: se avisó a otros repartidores");
      utils.courier.invalidate();
      utils.orders.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deliver = trpc.courier.markDelivered.useMutation({
    onSuccess: (_result, variables) => {
      setConfirmationCodes((current) => ({ ...current, [variables.orderId]: "" }));
      toast.success("Entrega confirmada. ¡Buen trabajo!");
      utils.courier.invalidate();
      utils.orders.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!isAuthenticated) return null;

  if (user?.appRole !== "courier") {
    return (
      <div className="mx-auto max-w-lg rounded-3xl bg-card p-8 text-center ring-1 ring-border">
        <p className="text-5xl">🏍️</p>
        <h1 className="font-display mt-3 text-xl font-extrabold">
          Esta zona es para repartidores
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cambia tu rol a “Soy repartidor” desde tu perfil para tomar entregas.
        </p>
      </div>
    );
  }

  const active = (mine.data ?? []).filter((d) => d.order.status === "picked_up");
  const done = (mine.data ?? []).filter((d) => d.order.status === "delivered");

  return (
    <div className="space-y-5">
      {/* Ganancias */}
      <section className="rounded-3xl bg-foreground p-5 text-white">
        <p className="text-xs font-extrabold uppercase tracking-wide text-white/60">
          Tus ganancias
        </p>
        <p className="font-display mt-1 text-3xl font-extrabold">
          {money(earnings.data?.earnings ?? 0)}
        </p>
        <div className="mt-3 flex gap-4 text-xs font-bold text-white/80">
          <span>✅ {earnings.data?.deliveries ?? 0} entregas</span>
          <span>🛵 {earnings.data?.active ?? 0} en curso</span>
          <span>{earnings.data?.rating != null ? `⭐ ${earnings.data.rating.toFixed(1)} (${earnings.data.ratingCount})` : "⭐ Sin calificaciones"}</span>
          <span>El 100% del envío es tuyo</span>
        </div>
      </section>

      {/* Disponibilidad para recibir avisos */}
      <button
        onClick={() => setAvailability.mutate({ available: !availability.data?.available })}
        disabled={setAvailability.isPending || availability.isLoading}
        className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-extrabold ring-1 ring-border ${availability.data?.available ? "bg-brand-soft text-brand-dark" : "bg-card text-muted-foreground"}`}
      >
        <span>{availability.data?.available ? "🟢 Disponible: recibes avisos de pedidos nuevos" : "⚫ No disponible: no recibirás avisos"}</span>
        <span className="text-xs underline">Cambiar</span>
      </button>

      {/* En curso */}
      {active.length > 0 && (
        <section className="space-y-3">
          <p className="rounded-xl bg-brand-soft px-3 py-2 text-xs font-bold text-brand-dark">📍 Comparte tu ubicación GPS mientras esta pantalla esté abierta y tengas permiso de ubicación.</p>
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
            Entregas en curso
          </h2>
          {active.map(({ order, business, items }) => (
            <div
              key={order.id}
              className="rounded-3xl bg-card p-4 shadow-sm ring-2 ring-brand"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-extrabold">
                    {order.code} · {business?.name}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                    {items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                  </p>
                </div>
                <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-extrabold text-brand-dark">
                  +{money(order.deliveryFee)}
                </span>
              </div>
              <div className="mt-3 space-y-1.5 text-xs font-bold">
                <p className="rounded-xl bg-secondary px-3 py-2">
                  📤 Recoge en: {business?.address}
                </p>
                <p className="rounded-xl bg-brand-soft px-3 py-2 text-brand-dark">
                  📍 Entrega en: {order.deliveryAddress}
                </p>
                <p className="px-1 text-muted-foreground">
                  👤 {order.customerName} · {order.customerPhone ?? "sin celular"} ·
                  cobra {money(order.total)} en efectivo
                </p>
              </div>
              <div className="mt-2 flex gap-2 text-xs font-extrabold">
                {business?.lat != null && business?.lng != null && (
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${business.lat},${business.lng}`} target="_blank" rel="noreferrer" className="flex-1 rounded-xl bg-secondary py-2 text-center">
                    🧭 Ir al local
                  </a>
                )}
                {order.deliveryLat != null && order.deliveryLng != null && (
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${order.deliveryLat},${order.deliveryLng}`} target="_blank" rel="noreferrer" className="flex-1 rounded-xl bg-secondary py-2 text-center">
                    🧭 Ir con el cliente
                  </a>
                )}
              </div>
              <div className="mt-3 rounded-xl bg-secondary p-3">
                <label htmlFor={`delivery-code-${order.id}`} className="mb-1 block text-xs font-extrabold">
                  Código de confirmación del cliente
                </label>
                <input
                  id={`delivery-code-${order.id}`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  disabled={isLocked(order.codeAttempts)}
                  value={confirmationCodes[order.id] ?? ""}
                  onChange={(event) => setConfirmationCodes((current) => ({
                    ...current,
                    [order.id]: event.target.value.replace(/\D/g, "").slice(0, 6),
                  }))}
                  placeholder="6 dígitos"
                  className="w-full rounded-xl border border-border bg-card px-3 py-2 text-center text-lg font-extrabold tracking-[0.35em] outline-none focus:ring-2 focus:ring-brand"
                />
                {isLocked(order.codeAttempts) ? (
                  <p className="mt-1 text-xs font-bold text-destructive">
                    🔒 Intentos agotados. Pide al cliente que genere un código nuevo desde su pedido y vuelve a intentarlo.
                  </p>
                ) : order.codeAttempts > 0 ? (
                  <p className="mt-1 text-xs font-bold text-amber-800">
                    Intentos fallidos: {order.codeAttempts} de {BUSINESS_RULES.maxCodeAttempts}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Pide el código al cliente cuando le entregues el pedido.</p>
                )}
              </div>
              {withinMinutes(order.courierAcceptedAt, BUSINESS_RULES.courierReleaseWindowMin) && (
                <button
                  disabled={release.isPending}
                  onClick={() => {
                    const reason = window.prompt("¿Por qué sueltas este pedido? (mínimo 5 caracteres)");
                    if (reason === null) return;
                    release.mutate({ orderId: order.id, reason: reason.trim() });
                  }}
                  className="mt-3 w-full rounded-xl border border-destructive py-2.5 text-xs font-extrabold text-destructive disabled:opacity-50"
                >
                  Soltar pedido (solo los primeros {BUSINESS_RULES.courierReleaseWindowMin} min)
                </button>
              )}
              <button
                disabled={deliver.isPending || isLocked(order.codeAttempts) || (confirmationCodes[order.id] ?? "").length !== 6}
                onClick={() => deliver.mutate({ orderId: order.id, confirmationCode: confirmationCodes[order.id] ?? "" })}
                className="mt-3 w-full rounded-xl bg-brand py-3 text-sm font-extrabold text-white disabled:opacity-50"
              >
                {deliver.isPending ? "Verificando código…" : "✔️ Confirmar entrega"}
              </button>
              <div className="mt-3">
                <ChatBox orderId={order.id} />
              </div>
              <ClaimBox orderId={order.id} role="courier" collapsible />
            </div>
          ))}
        </section>
      )}

      {/* Disponibles */}
      <section className="space-y-3">
        <h2 className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          Pedidos disponibles ({available.data?.length ?? 0})
        </h2>
        {(available.data?.length ?? 0) === 0 ? (
          <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">
            <p className="text-4xl">☕</p>
            <p className="font-display mt-2 font-extrabold">
              Nada por ahora, descansa
            </p>
            <p className="text-sm text-muted-foreground">
              Los pedidos listos en los locales aparecerán aquí
            </p>
          </div>
        ) : (
          available.data!.map(({ order, business }) => (
            <div
              key={order.id}
              className="flex items-center gap-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-secondary text-2xl">
                {business?.emoji ?? "🍽️"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">
                  {business?.name}
                  <span className="ml-2 text-xs font-bold text-muted-foreground">
                    {timeAgo(order.createdAt)}
                  </span>
                </p>
                <p className="truncate text-xs font-semibold text-muted-foreground">
                  📍 {order.deliveryDistanceKm != null ? `A ${order.deliveryDistanceKm} km del local` : "Entrega a domicilio"} · cobras {money(order.total)} en efectivo
                </p>
                <p className="text-[11px] text-muted-foreground">La dirección del cliente se muestra al aceptar.</p>
              </div>
              <button
                disabled={accept.isPending}
                onClick={() => accept.mutate({ orderId: order.id })}
                className="shrink-0 rounded-xl bg-brand px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
              >
                Tomar · {money(order.deliveryFee)}
              </button>
            </div>
          ))
        )}
      </section>

      {/* Historial */}
      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
            Historial
          </h2>
          {done.slice(0, 10).map(({ order, business }) => (
            <div
              key={order.id}
              className="rounded-2xl bg-card px-4 py-3 ring-1 ring-border"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-muted-foreground">
                  ✅ {order.code} · {business?.name}
                </p>
                <span className="text-xs font-extrabold text-brand-dark">
                  +{money(order.deliveryFee)}
                </span>
              </div>
              <ClaimBox orderId={order.id} role="courier" collapsible />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
