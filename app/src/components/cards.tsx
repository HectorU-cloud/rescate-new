import { Link } from "react-router";
import type { Business, RescuePack } from "@db/schema";
import { money } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/format";

export function BusinessCard({ business }: { business: Business }) {
  return (
    <Link
      to={`/negocio/${business.id}`}
      className="group flex flex-col overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border transition-shadow hover:shadow-md"
    >
      <div className="relative grid h-32 place-items-center bg-gradient-to-br from-brand-soft to-secondary text-6xl">
        <span className="drop-shadow-sm transition-transform group-hover:scale-110">
          {business.emoji}
        </span>
        {!business.isOpen && (
          <span className="absolute left-3 top-3 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-bold text-white">
            Cerrado
          </span>
        )}
        <span className="absolute bottom-3 right-3 rounded-full bg-card px-2.5 py-1 text-[11px] font-extrabold text-foreground shadow-sm">
          ⭐ {business.rating.toFixed(1)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="font-display text-base font-bold leading-tight">
          {business.name}
        </h3>
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {CATEGORY_LABELS[business.category] ?? business.category} ·{" "}
          {business.address}
        </p>
        <div className="mt-auto flex items-center gap-3 pt-2 text-xs font-bold text-foreground/80">
          <span>🛵 {business.deliveryMinutes} min</span>
          <span>Envío {money(business.deliveryFee)}</span>
        </div>
      </div>
    </Link>
  );
}

export function RescueCard({
  pack,
  business,
}: {
  pack: RescuePack;
  business: Business | null;
}) {
  const discount = Math.round(
    (1 - pack.rescuePrice / pack.originalPrice) * 100,
  );
  const inner = (
    <div className="group relative flex gap-3 overflow-hidden rounded-3xl bg-card p-3 shadow-sm ring-1 ring-border">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-rescue-soft">
        {pack.imageUrl ? <img src={pack.imageUrl} alt={pack.title} loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-4xl">{business?.emoji ?? "🎁"}</div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-sm font-bold leading-tight">
            {pack.title}
          </h3>
          <span className="shrink-0 rounded-full bg-rescue px-2 py-0.5 text-[11px] font-extrabold text-white">
            −{discount}%
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {business?.name} · retiro {pack.pickupStart}–{pack.pickupEnd}
        </p>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-lg font-extrabold text-rescue">
              {money(pack.rescuePrice)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground line-through">
              {money(pack.originalPrice)}
            </span>
          </div>
          <span className="text-[11px] font-bold text-muted-foreground">
            {pack.quantityLeft} disp.
          </span>
        </div>
      </div>
    </div>
  );
  return business ? (
    <Link to={`/negocio/${business.id}?rescate=1`}>{inner}</Link>
  ) : (
    inner
  );
}
