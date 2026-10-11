import { useEffect } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { money } from "@/lib/format";
import { toast } from "sonner";

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-1.5 select-none">
      <span className="grid h-9 w-9 place-items-center rounded-2xl bg-brand text-lg shadow-sm">
        🛵
      </span>
      <span className="font-display text-xl font-bold tracking-tight text-foreground">
        Al Rescate
        <span className="text-rescue">.</span>
      </span>
    </Link>
  );
}

type NavItem = { to: string; label: string; icon: string };

function useNavItems(): NavItem[] {
  const { user } = useAuth();
  const role = user?.appRole;
  if (role === "business") {
    return [
      { to: "/panel", label: "Mi local", icon: "🏪" },
      { to: "/", label: "Explorar", icon: "🧭" },
      { to: "/rescate", label: "Rescate", icon: "🧡" },
      { to: "/perfil", label: "Perfil", icon: "👤" },
    ];
  }
  if (role === "courier") {
    return [
      { to: "/repartidor", label: "Repartos", icon: "🏍️" },
      { to: "/", label: "Explorar", icon: "🧭" },
      { to: "/rescate", label: "Rescate", icon: "🧡" },
      { to: "/perfil", label: "Perfil", icon: "👤" },
    ];
  }
  return [
    { to: "/", label: "Inicio", icon: "🏠" },
    { to: "/rescate", label: "Rescate", icon: "🧡" },
    { to: "/pedidos", label: "Pedidos", icon: "🧾" },
    { to: "/perfil", label: "Perfil", icon: "👤" },
  ];
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const { cart, count, subtotal } = useCart();
  const items = useNavItems();
  const location = useLocation();
  const navigate = useNavigate();
  const showCartBar =
    !!cart && count > 0 && location.pathname !== "/carrito";

  // Usuario nuevo sin rol → pantalla de bienvenida
  useEffect(() => {
    if (user && !user.appRole && location.pathname !== "/bienvenida") {
      navigate("/bienvenida", { replace: true });
    }
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    const onPush = (event: Event) => {
      const payload = (event as CustomEvent<{ notification?: { title?: string; body?: string } }>).detail;
      toast.info(payload?.notification?.title ?? "Actualización de Rescate", { description: payload?.notification?.body });
    };
    window.addEventListener("rescate:push", onPush);
    return () => window.removeEventListener("rescate:push", onPush);
  }, []);

  return (
    <div className="min-h-dvh bg-background">
      {/* Cabecera */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                    isActive
                      ? "bg-brand-soft text-brand-dark"
                      : "text-muted-foreground hover:text-foreground"
                  }`
                }
              >
                <span className="mr-1">{it.icon}</span>
                {it.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/carrito")}
              className="relative grid h-10 w-10 place-items-center rounded-full bg-card shadow-sm ring-1 ring-border"
              aria-label="Carrito"
            >
              🛒
              {count > 0 && (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rescue px-1 text-[11px] font-extrabold text-white">
                  {count}
                </span>
              )}
            </button>
            {!isAuthenticated && (
              <button
                onClick={() => navigate("/login")}
                className="hidden rounded-full bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm md:block"
              >
                Entrar
              </button>
            )}
            {user && (
              <Link
                to="/perfil"
                className="hidden h-10 w-10 place-items-center overflow-hidden rounded-full bg-brand-soft ring-1 ring-border md:grid"
              >
                {user.avatar ? (
                  <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-extrabold text-brand-dark">
                    {(user.name ?? "A")[0]}
                  </span>
                )}
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="mx-auto w-full max-w-5xl px-4 pb-32 pt-4 md:pb-16">
        {children}
      </main>

      {/* Barra de carrito flotante */}
      {showCartBar && (
        <div className="fixed inset-x-0 bottom-[4.5rem] z-40 px-4 md:bottom-6">
          <button
            onClick={() => navigate("/carrito")}
            className="animate-slide-up mx-auto flex w-full max-w-lg items-center justify-between rounded-2xl bg-foreground px-5 py-3.5 text-white shadow-xl"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-rescue text-xs font-extrabold">
                {count}
              </span>
              {cart!.businessName}
            </span>
            <span className="font-display text-base font-bold">
              Ver carrito · {money(subtotal)}
            </span>
          </button>
        </div>
      )}

      {/* Navegación inferior móvil */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {items.map((it) => {
            const active =
              it.to === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(it.to);
            return (
              <NavLink
                key={it.to}
                to={it.to}
                className="flex flex-col items-center gap-0.5 py-2.5"
              >
                <span
                  className={`grid h-8 w-14 place-items-center rounded-full text-lg transition-colors ${
                    active ? "bg-brand-soft" : ""
                  }`}
                >
                  {it.icon}
                </span>
                <span
                  className={`text-[11px] font-bold ${
                    active ? "text-brand-dark" : "text-muted-foreground"
                  }`}
                >
                  {it.label}
                </span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
