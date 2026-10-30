import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";

/** Campana de la cabecera: lleva al centro de notificaciones y muestra cuántas hay sin leer. */
export default function NotificationBell() {
  const { isAuthenticated } = useAuth();
  const unread = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  if (!isAuthenticated) return null;
  const count = unread.data?.count ?? 0;
  return (
    <Link
      to="/notificaciones"
      className="relative grid h-10 w-10 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border"
      aria-label={count > 0 ? `Notificaciones: ${count} sin leer` : "Notificaciones"}
    >
      🔔
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-extrabold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
