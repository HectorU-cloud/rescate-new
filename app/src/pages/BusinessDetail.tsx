import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { CATEGORY_LABELS, money } from "@/lib/format";
import { toast } from "sonner";

export default function BusinessDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const businessId = Number(id);
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { cart, add } = useCart();
  const detail = trpc.catalog.businessDetail.useQuery(
    { id: businessId },
    { enabled: Number.isFinite(businessId) },
  );
  const createRescue = trpc.orders.createRescue.useMutation({
    onSuccess: (data) => {
      toast.success("¡Pack rescatado! Muestra tu código al retirar");
      if (data) navigate(`/pedido/${data.order.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const [rescuingPack, setRescuingPack] = useState<number | null>(null);

  const cartFromHere = cart?.businessId === businessId;
  const initialTab = searchParams.get("rescate") === "1" ? "rescate" : "menu";
  const [tab, setTab] = useState<"menu" | "rescate">(
    initialTab === "rescate" ? "rescate" : "menu",
  );

  const business = detail.data?.business;
  const products = useMemo(
    () => (detail.data?.products ?? []).filter((p) => p.isAvailable),
    [detail.data],
  );
  const packs = detail.data?.rescuePacks ?? [];

  if (detail.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-40 animate-pulse rounded-3xl bg-muted" />
        <div className="h-24 animate-pulse rounded-3xl bg-muted" />
      </div>
    );
  }
  if (!business) {
    return (
      <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">
        <p className="text-4xl">😢</p>
        <p className="mt-2 font-display font-bold">Este local no existe</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Encabezado del local */}
      <section className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border">
        <div className="grid h-36 place-items-center bg-gradient-to-br from-brand-soft to-secondary text-7xl">
          {business.emoji}
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-extrabold leading-tight">
                {business.name}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {business.description}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-extrabold">
              ⭐ {business.rating.toFixed(1)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-foreground/80">
            <span>📍 {business.address}</span>
            <span>🛵 {business.deliveryMinutes} min aprox.</span>
            <span>Envío {money(business.deliveryFee)}</span>
            <span>{CATEGORY_LABELS[business.category] ?? business.category}</span>
          </div>
          {!business.isOpen && (
            <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
              Este local está cerrado ahora mismo
            </p>
          )}
          {cart && !cartFromHere && (
            <p className="mt-3 rounded-xl bg-rescue-soft px-3 py-2 text-xs font-bold text-rescue-dark">
              Tu carrito es de {cart.businessName}: si agregas algo aquí, se
              reemplazará.
            </p>
          )}
        </div>
      </section>

      {/* Tabs menú / rescate */}
      {packs.length > 0 && (
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1">
          <button
            onClick={() => setTab("menu")}
            className={`rounded-xl py-2 text-sm font-extrabold transition-colors ${
              tab === "menu" ? "bg-card shadow-sm" : "text-muted-foreground"
            }`}
          >
            🍽️ Menú
          </button>
          <button
            onClick={() => setTab("rescate")}
            className={`rounded-xl py-2 text-sm font-extrabold transition-colors ${
              tab === "rescate" ? "bg-card shadow-sm" : "text-muted-foreground"
            }`}
          >
            🧡 Rescate ({packs.length})
          </button>
        </div>
      )}

      {/* Menú */}
      {tab === "menu" && (
        <section className="space-y-2">
          {products.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-border"
            >
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
              ) : (
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-secondary text-3xl">
                  {p.emoji}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold">{p.name}</p>
                {p.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {p.description}
                  </p>
                )}
                <p className="font-display mt-0.5 text-sm font-extrabold text-brand-dark">
                  {money(p.price)}
                </p>
              </div>
              <button
                disabled={!business.isOpen}
                onClick={() => {
                  add(
                    {
                      id: business.id,
                      name: business.name,
                      deliveryFee: business.deliveryFee,
                    },
                    {
                      productId: p.id,
                      name: p.name,
                      price: p.price,
                      emoji: p.emoji,
                    },
                  );
                  toast.success(`${p.name} agregado`);
                }}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-xl font-bold text-white shadow-sm transition-transform active:scale-90 disabled:opacity-40"
                aria-label={`Agregar ${p.name}`}
              >
                +
              </button>
            </div>
          ))}
          {products.length === 0 && (
            <p className="rounded-2xl bg-card p-6 text-center text-sm font-semibold text-muted-foreground ring-1 ring-border">
              Este local aún no publicó su menú
            </p>
          )}
        </section>
      )}

      {/* Packs de rescate */}
      {tab === "rescate" && (
        <section className="space-y-3">
          {packs.map((pack) => {
            const discount = Math.round(
              (1 - pack.rescuePrice / pack.originalPrice) * 100,
            );
            const pending = rescuingPack === pack.id && createRescue.isPending;
            return (
              <div
                key={pack.id}
                className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border"
              >
                <div className="bg-rescue-soft px-4 py-2 text-[11px] font-extrabold uppercase tracking-wide text-rescue-dark">
                  Quedan {pack.quantityLeft} · retiro hoy {pack.pickupStart}–
                  {pack.pickupEnd}
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg font-extrabold">
                        {pack.title}
                      </h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {pack.description}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-rescue px-2.5 py-1 text-xs font-extrabold text-white">
                      −{discount}%
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-2xl font-extrabold text-rescue">
                        {money(pack.rescuePrice)}
                      </span>
                      <span className="text-sm font-semibold text-muted-foreground line-through">
                        {money(pack.originalPrice)}
                      </span>
                    </div>
                    <button
                      disabled={pending || !business.isOpen}
                      onClick={() => {
                        if (!isAuthenticated) {
                          navigate("/login");
                          return;
                        }
                        setRescuingPack(pack.id);
                        createRescue.mutate({
                          rescuePackId: pack.id,
                          quantity: 1,
                        });
                      }}
                      className="rounded-full bg-rescue px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50"
                    >
                      {pending ? "Rescatando…" : "¡Rescatar!"}
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
                    Pagas en efectivo al retirar · contenido sorpresa según lo
                    que quedó del día
                  </p>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
