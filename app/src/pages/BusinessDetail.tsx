import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { CATEGORY_LABELS, money } from "@/lib/format";
import { toast } from "sonner";
import { packDayLabel } from "@contracts/packs";

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
              {business.ratingCount > 0 ? `⭐ ${business.rating.toFixed(1)} (${business.ratingCount})` : "✨ Nuevo"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-foreground/80">
            <span>📍 {business.address}</span>
            <span>🛵 {business.deliveryMinutes} min aprox.</span>
            <span>Envío desde {money(business.deliveryFee)}</span>
            <span>🕒 {business.opensAt}–{business.closesAt}</span>
            <span>Radio {business.deliveryRadiusKm} km</span>
            {business.minOrder > 0 && <span>Mínimo {money(business.minOrder)}</span>}
            <span>{CATEGORY_LABELS[business.category] ?? business.category}</span>
          </div>
          {!business.openNow && (
            <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
              Este local está cerrado ahora mismo (atiende de {business.opensAt} a {business.closesAt})
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
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3 px-1">
            <div>
              <h2 className="font-display text-lg font-extrabold">Menú del local</h2>
              <p className="text-xs font-medium text-muted-foreground">{products.length} producto{products.length === 1 ? "" : "s"} disponible{products.length === 1 ? "" : "s"}</p>
            </div>
            <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-extrabold text-brand-dark">Actualizado</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
          {products.map((p) => {
            const description = p.description?.trim() ?? "";
            const ingredientMatch = description.match(/(?:ingredientes|contiene)\s*:\s*(.*)/i);
            const ingredients = ingredientMatch?.[1]?.trim();
            const productDescription = ingredients
              ? description.slice(0, ingredientMatch!.index).replace(/[·|,;\s]+$/, "").trim()
              : description;
            return (
            <article
              key={p.id}
              className="group overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="relative h-36 overflow-hidden bg-gradient-to-br from-brand-soft to-secondary sm:h-40">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-6xl">{p.emoji}</div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-extrabold text-brand-dark shadow-sm">Disponible</span>
              </div>
              <div className="p-3.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-extrabold leading-tight">{p.name}</p>
                    {productDescription && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{productDescription}</p>
                    )}
                  </div>
                  <p className="font-display shrink-0 text-base font-extrabold text-brand-dark">{money(p.price)}</p>
                </div>
                {ingredients && (
                  <p className="mt-2 rounded-xl bg-secondary/70 px-2.5 py-2 text-[11px] leading-relaxed text-foreground/80">
                    <span className="font-extrabold">Ingredientes: </span>{ingredients}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
                  <span className="text-[11px] font-semibold text-muted-foreground">Precio por unidad</span>
              <button
                disabled={!business.openNow}
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
              </div>
            </article>
          );})}
          </div>
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
                  Quedan {pack.quantityLeft} · retiro {packDayLabel(pack.pickupStart, pack.pickupEnd, pack.expiresAt)} {pack.pickupStart}–
                  {pack.pickupEnd}
                </div>
                {pack.imageUrl && <img src={pack.imageUrl} alt={pack.title} loading="lazy" className="h-44 w-full object-cover" />}
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
                      disabled={pending || !business.openNow || !pack.reservable}
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
                      {pending ? "Rescatando…" : !pack.reservable ? "Retiro terminado" : "¡Rescatar!"}
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
