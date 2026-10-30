import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { timeAgo } from "@/lib/format";

const PAGE = 30;
const MAX = 100;

/** Historial de avisos de Rescate (los mismos que llegan por push), con estado leído / sin leer. */
export default function Notifications() {
  const { isAuthenticated } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [limit, setLimit] = useState(PAGE);
  const list = trpc.notifications.list.useQuery({ limit }, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const refresh = () => {
    void utils.notifications.list.invalidate();
    void utils.notifications.unreadCount.invalidate();
  };
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: refresh });
  const markAll = trpc.notifications.markAllRead.useMutation({ onSuccess: refresh });

  const items = list.data ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Notificaciones</h1>
        <button
          type="button"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
          className="rounded-full bg-secondary px-4 py-2 text-xs font-extrabold disabled:opacity-40"
        >
          Marcar todas como leídas
        </button>
      </div>

      {list.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {!list.isLoading && items.length === 0 && (
        <div className="rounded-3xl bg-card p-8 text-center shadow-sm ring-1 ring-border">
          <p className="text-4xl">🔔</p>
          <p className="mt-2 text-sm font-bold">Aún no tienes notificaciones</p>
          <p className="mt-1 text-xs text-muted-foreground">Aquí verás el estado de tus pedidos y otros avisos de Rescate.</p>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                if (!n.readAt) markRead.mutate({ id: n.id });
                if (n.url) navigate(n.url);
              }}
              className={`flex w-full items-start gap-3 rounded-2xl p-4 text-left shadow-sm ring-1 ring-border ${n.readAt ? "bg-card" : "bg-brand-soft"}`}
            >
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand"}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-extrabold">{n.title}</span>
                <span className="mt-0.5 block text-xs text-foreground/80">{n.body}</span>
                <span className="mt-1 block text-[11px] font-semibold text-muted-foreground">{timeAgo(n.createdAt)}</span>
              </span>
              {!n.readAt && <span className="sr-only">Sin leer</span>}
            </button>
          </li>
        ))}
      </ul>

      {items.length >= limit && limit < MAX && (
        <button type="button" onClick={() => setLimit((l) => Math.min(MAX, l + PAGE))} className="w-full rounded-2xl bg-secondary py-3 text-sm font-extrabold">
          Ver más
        </button>
      )}
      <p className="text-center text-[11px] text-muted-foreground">Los avisos leídos se borran solos a los 30 días.</p>
    </div>
  );
}
