import { useDialogs } from "@/providers/dialogs";
import { useState } from "react";
import { Link, Navigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { money, timeAgo } from "@/lib/format";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/router";

type Overview = inferRouterOutputs<AppRouter>["admin"]["overview"];

type Tab = "metricas" | "comercios" | "pedidos" | "reclamos";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  accepted: "Aceptado",
  preparing: "Preparando",
  ready: "Listo",
  picked_up: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const card = "rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border";

export default function AdminDashboard() {
  const { user, isAuthenticated } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const [tab, setTab] = useState<Tab>("metricas");
  const overview = trpc.admin.overview.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
    refetchInterval: 20_000,
  });

  if (!isAuthenticated || !user) return null;
  if (user.role !== "admin") return <Navigate to="/" replace />;

  const o = overview.data;
  const badge = (n?: number) => (n ? ` (${n})` : "");

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Administración</h1>
          <p className="text-xs font-bold text-muted-foreground">Comercios, pedidos, reclamos y métricas</p>
        </div>
        <div className="flex gap-2 text-xs font-extrabold">
          <Link to="/admin/verificacion" className="rounded-full bg-secondary px-3 py-2">
            Verificar repartidores{badge(o?.pendingCouriers)}
          </Link>
          <Link to="/admin/repartidores" className="rounded-full bg-secondary px-3 py-2">
            Todos los repartidores
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1 md:grid-cols-4">
        {(
          [
            ["metricas", "📊 Métricas"],
            ["comercios", `🏪 Comercios${badge(o?.pendingBusinesses)}`],
            ["pedidos", "🧾 Pedidos"],
            ["reclamos", `🚩 Reclamos${badge(o?.openClaims)}`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl py-2 text-xs font-extrabold md:text-sm ${tab === t ? "bg-card shadow-sm" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "metricas" && <Metrics data={o} loading={overview.isLoading} />}
      {tab === "comercios" && <BusinessesTab />}
      {tab === "pedidos" && <OrdersTab />}
      {tab === "reclamos" && <ClaimsTab />}
    </div>
  );
}

// ---------------------------------------------------------------- Métricas
function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 shadow-sm ring-1 ring-border ${warn ? "bg-amber-100" : "bg-card"}`}>
      <p className="font-display text-xl font-extrabold">{value}</p>
      <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
    </div>
  );
}

function Metrics({ data, loading }: { data: Overview | undefined; loading: boolean }) {
  if (loading || !data) return <div className="h-48 animate-pulse rounded-3xl bg-muted" />;
  const maxOrders = Math.max(1, ...data.perDay.map((d) => d.orders));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pedidos hoy" value={String(data.todayOrders)} />
        <Stat label="Ventas hoy (entregadas)" value={money(data.todayRevenue)} />
        <Stat label="Activos ahora" value={String(data.activeOrders)} />
        <Stat label="Esperando repartidor" value={String(data.waitingCourier)} warn={data.waitingCourier > 0} />
        <Stat label="Pedidos totales" value={String(data.totalOrders)} />
        <Stat label="Ventas totales" value={money(data.revenue)} />
        <Stat label="Envíos pagados a repartidores" value={money(data.deliveryFees)} />
        <Stat label="Rescates completados" value={String(data.rescues)} />
        <Stat label="Tiempo medio de entrega" value={data.avgDeliveryMin == null ? "—" : `${data.avgDeliveryMin} min`} />
        <Stat label="Tasa de cancelación" value={`${Math.round(data.cancellationRate * 100)}%`} warn={data.cancellationRate > 0.2} />
        <Stat label="Cancelados por vencimiento" value={String(data.expired)} warn={data.expired > 0} />
        <Stat label="Repartidores disponibles" value={String(data.availableCouriers)} warn={data.availableCouriers === 0} />
        <Stat label="Comercios por aprobar" value={String(data.pendingBusinesses)} warn={data.pendingBusinesses > 0} />
        <Stat label="Repartidores por verificar" value={String(data.pendingCouriers)} warn={data.pendingCouriers > 0} />
        <Stat label="Reclamos abiertos" value={String(data.openClaims)} warn={data.openClaims > 0} />
        <Stat label="Calificación media de comercios" value={data.avgBusinessRating == null ? "—" : `⭐ ${data.avgBusinessRating} (${data.ratingsCount})`} warn={data.avgBusinessRating != null && data.avgBusinessRating < 3.5} />
        <Stat label="Calificación media de repartidores" value={data.avgCourierRating == null ? "—" : `⭐ ${data.avgCourierRating} (${data.courierRatingsCount})`} warn={data.avgCourierRating != null && data.avgCourierRating < 3.5} />
      </div>

      <section className={card}>
        <p className="mb-3 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Pedidos de los últimos 7 días</p>
        {data.perDay.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay pedidos en este periodo.</p>
        ) : (
          <ul className="space-y-2">
            {data.perDay.map((d) => (
              <li key={d.day} className="flex items-center gap-3 text-xs font-bold">
                <span className="w-20 shrink-0 text-muted-foreground">{d.day.slice(5)}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(d.orders / maxOrders) * 100}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right">{d.orders} · {money(d.revenue)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.lowRatedBusinesses.length > 0 && (
        <section className={`${card} ring-amber-300`}>
          <p className="mb-3 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">⚠️ Comercios con calificación baja</p>
          <ul className="space-y-1.5 text-sm font-semibold">
            {data.lowRatedBusinesses.map((b) => (
              <li key={b.id} className="flex justify-between">
                <span>{b.name}</span>
                <span className="text-muted-foreground">⭐ {b.rating.toFixed(1)} · {b.ratingCount} calificaciones</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <p className="mb-3 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Comercios con más pedidos</p>
        {data.topBusinesses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin datos todavía.</p>
        ) : (
          <ul className="space-y-1.5 text-sm font-semibold">
            {data.topBusinesses.map((b, i) => (
              <li key={b.id} className="flex justify-between">
                <span>{i + 1}. {b.name}</span>
                <span className="text-muted-foreground">{b.orders} pedidos · {money(b.revenue)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Comercios
function BusinessesTab() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const list = trpc.admin.businesses.useQuery({ status });
  const dialogs = useDialogs();
  const review = trpc.admin.reviewBusiness.useMutation({
    onSuccess: () => {
      toast.success("Comercio actualizado");
      utils.admin.businesses.invalidate();
      utils.admin.overview.invalidate();
      utils.catalog.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-xs font-extrabold">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1.5 ${status === s ? "bg-foreground text-white" : "bg-secondary"}`}>
            {s === "pending" ? "Por aprobar" : s === "approved" ? "Aprobados" : "Rechazados"}
          </button>
        ))}
      </div>
      {list.isLoading && <div className="h-24 animate-pulse rounded-2xl bg-muted" />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && <p className={`${card} text-center text-sm text-muted-foreground`}>No hay comercios en esta lista.</p>}
      {list.data?.map((b) => (
        <article key={b.id} className={`${card} space-y-2`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-extrabold">{b.emoji} {b.name}</h2>
              <p className="text-xs font-semibold text-muted-foreground">{b.address} · {b.phone ?? "sin teléfono"}</p>
              {(b.pendingName || b.pendingAddress) && <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><p className="font-extrabold">📝 Solicitud de cambio de datos</p>{b.pendingName && <p>Nombre actual: <b>{b.name}</b> → solicitado: <b>{b.pendingName}</b></p>}{b.pendingAddress && <p>Dirección actual: <b>{b.address}</b> → solicitada: <b>{b.pendingAddress}</b></p>}</div>}
              <p className="text-xs text-muted-foreground">Dueño: {b.ownerName ?? "—"} · {b.ownerEmail ?? "sin correo"}</p>
              <p className={`text-xs font-bold ${b.locationConfirmed ? "text-brand-dark" : "text-destructive"}`}>
                {b.locationConfirmed ? (
                  <>
                    📍 Ubicación confirmada ·{" "}
                    <a href={`https://www.google.com/maps?q=${b.lat},${b.lng}`} target="_blank" rel="noreferrer" className="underline">
                      ver en el mapa
                    </a>
                  </>
                ) : (
                  "⚠️ Aún no marcó su ubicación en el mapa: no se puede aprobar"
                )}
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-bold text-muted-foreground">{timeAgo(b.createdAt)}</span>
          </div>
          <p className="text-xs font-bold text-muted-foreground">
            {b.ratingCount > 0 ? `⭐ ${b.rating.toFixed(1)} (${b.ratingCount}) · ` : "✨ Sin calificaciones · "}🕒 {b.opensAt}–{b.closesAt} · radio {b.deliveryRadiusKm} km · envío {money(b.deliveryFee)} + {money(b.feePerKm)}/km · mínimo {money(b.minOrder)}
          </p>
          {b.approvalNote && <p className="text-xs font-bold text-destructive">Motivo: {b.approvalNote}</p>}
          <div className="flex gap-2">
            {(b.approvalStatus !== "approved" || Boolean(b.pendingName || b.pendingAddress)) && (
              <button
                disabled={review.isPending || !b.locationConfirmed}
                onClick={() => review.mutate({ id: b.id, decision: "approved" })}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
              >
                {b.approvalStatus === "approved" ? "Aprobar cambios" : "Aprobar"}
              </button>
            )}
            {(b.approvalStatus !== "rejected" || Boolean(b.pendingName || b.pendingAddress)) && (
              <button
                disabled={review.isPending}
                onClick={async () => {
                  const note = await dialogs.prompt({ title: "Motivo", description: "Lo verá el comercio.", placeholder: "Motivo", confirmLabel: "Enviar" });
                  if (!note) return;
                  review.mutate({ id: b.id, decision: "rejected", note });
                }}
                className="flex-1 rounded-xl border border-destructive py-2.5 text-sm font-extrabold text-destructive disabled:opacity-50"
              >
                {b.approvalStatus === "approved"
                ? (b.pendingName || b.pendingAddress
                    ? "Rechazar cambios"
                    : "Suspender")
                : "Rechazar"}
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Pedidos
function OrdersTab() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<string>("");
  const [openId, setOpenId] = useState<number | null>(null);
  const list = trpc.admin.orders.useQuery(
    { status: (status || undefined) as "pending" | undefined, limit: 100 },
    { refetchInterval: 20_000 },
  );
  const timeline = trpc.admin.orderTimeline.useQuery({ orderId: openId ?? 0 }, { enabled: openId !== null });
  const dialogs = useDialogs();
  const cancel = trpc.admin.cancelOrder.useMutation({
    onSuccess: () => {
      toast.success("Pedido cancelado");
      utils.admin.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-2 text-sm font-bold">
        <option value="">Todos los estados</option>
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      {list.isLoading && <div className="h-24 animate-pulse rounded-2xl bg-muted" />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && <p className={`${card} text-center text-sm text-muted-foreground`}>No hay pedidos.</p>}
      {list.data?.map((o) => {
        const closed = o.status === "delivered" || o.status === "cancelled";
        return (
          <article key={o.id} className={`${card} space-y-2`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-extrabold">{o.code} · {o.businessName ?? "—"}</p>
                <p className="text-xs font-semibold text-muted-foreground">
                  {o.type === "delivery" ? "🛵 Delivery" : "🧡 Rescate"} · {o.customerName ?? "Cliente"} · {o.customerPhone ?? "sin celular"}
                </p>
                {o.deliveryAddress && <p className="text-xs text-muted-foreground">📍 {o.deliveryAddress}{o.deliveryDistanceKm != null ? ` · ${o.deliveryDistanceKm} km` : ""}</p>}
              </div>
              <div className="text-right">
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-extrabold">{STATUS_LABEL[o.status]}</span>
                <p className="mt-1 text-sm font-extrabold">{money(o.total)}</p>
              </div>
            </div>
            {o.status === "cancelled" && (
              <p className="text-xs font-bold text-destructive">
                Cancelado por {o.cancelledBy ?? "—"}{o.cancelReason ? `: ${o.cancelReason}` : ""}
              </p>
            )}
            <div className="flex gap-2 text-xs font-extrabold">
              <button onClick={() => setOpenId(openId === o.id ? null : o.id)} className="rounded-xl bg-secondary px-3 py-2">
                {openId === o.id ? "Ocultar historial" : "Ver historial"}
              </button>
              {!closed && (
                <button
                  disabled={cancel.isPending}
                  onClick={async () => {
                    const reason = await dialogs.prompt({ title: "Cancelar pedido", description: "Lo verá el cliente.", placeholder: "Motivo (mínimo 5 caracteres)", minLength: 5, confirmLabel: "Cancelar pedido" });
                    if (!reason) return;
                    cancel.mutate({ orderId: o.id, reason });
                  }}
                  className="rounded-xl border border-destructive px-3 py-2 text-destructive disabled:opacity-50"
                >
                  Cancelar pedido
                </button>
              )}
              <span className="ml-auto self-center text-[11px] text-muted-foreground">{timeAgo(o.createdAt)}</span>
            </div>
            {openId === o.id && (
              <ul className="space-y-1 rounded-xl bg-secondary p-3 text-xs font-semibold">
                {timeline.isLoading && <li>Cargando…</li>}
                {(timeline.data ?? []).length === 0 && !timeline.isLoading && <li className="text-muted-foreground">Sin eventos registrados.</li>}
                {timeline.data?.map((e) => (
                  <li key={e.id}>
                    <b>{e.type}</b> · {e.actorRole}{e.detail ? ` · ${e.detail}` : ""} <span className="text-muted-foreground">({timeAgo(e.createdAt)})</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------- Reclamos
function ClaimsTab() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"open" | "resolved" | "rejected">("open");
  const list = trpc.admin.claims.useQuery({ status });
  const dialogs = useDialogs();
  const resolve = trpc.admin.resolveClaim.useMutation({
    onSuccess: () => {
      toast.success("Reclamo respondido");
      utils.admin.claims.invalidate();
      utils.admin.overview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const answer = async (id: number, decision: "resolved" | "rejected") => {
    const resolution = await dialogs.prompt({
      title: decision === "resolved" ? "Responder reclamo" : "Rechazar reclamo",
      description: decision === "resolved" ? "Respuesta para quien reclamó (qué se hará)." : "Motivo del rechazo (lo verá quien reclamó).",
      placeholder: "Mínimo 5 caracteres",
      minLength: 5,
      confirmLabel: decision === "resolved" ? "Responder" : "Rechazar",
    });
    if (!resolution) return;
    resolve.mutate({ id, decision, resolution });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-xs font-extrabold">
        {(["open", "resolved", "rejected"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1.5 ${status === s ? "bg-foreground text-white" : "bg-secondary"}`}>
            {s === "open" ? "Abiertos" : s === "resolved" ? "Resueltos" : "Rechazados"}
          </button>
        ))}
      </div>
      {list.isLoading && <div className="h-24 animate-pulse rounded-2xl bg-muted" />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && <p className={`${card} text-center text-sm text-muted-foreground`}>No hay reclamos en esta lista.</p>}
      {list.data?.map((c) => (
        <article key={c.id} className={`${card} space-y-2`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold">Pedido {c.orderCode ?? `#${c.orderId}`} · {c.orderStatus ? STATUS_LABEL[c.orderStatus] : "—"}</p>
              <p className="text-xs font-semibold text-muted-foreground">
                {c.reporterName ?? "Usuario"} ({c.reporterRole === "business" ? "comercio" : c.reporterRole === "courier" ? "repartidor" : "cliente"}) · {c.reporterPhone ?? c.reporterEmail ?? "sin contacto"}
              </p>
            </div>
            <span className="text-[11px] font-bold text-muted-foreground">{timeAgo(c.createdAt)}</span>
          </div>
          <p className="rounded-xl bg-secondary px-3 py-2 text-sm font-semibold">{c.reason}</p>
          {c.resolution && <p className="text-xs font-bold text-muted-foreground">Respuesta: {c.resolution}</p>}
          {c.status === "open" && (
            <div className="flex gap-2">
              <button disabled={resolve.isPending} onClick={() => answer(c.id, "resolved")} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-extrabold text-white disabled:opacity-50">
                Resolver
              </button>
              <button
                disabled={resolve.isPending}
                onClick={() => answer(c.id, "rejected")}
                className="flex-1 rounded-xl border border-destructive py-2.5 text-sm font-extrabold text-destructive disabled:opacity-50"
              >
                Rechazar
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
