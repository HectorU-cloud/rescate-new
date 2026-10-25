import { Link } from "react-router";
import type { Business, RescuePack } from "@db/schema";
import { money } from "@/lib/format";
import { packDayLabel } from "@contracts/packs";
import { CATEGORY_LABELS } from "@/lib/format";

export function BusinessCard({ business }: { business: Business & { openNow: boolean } }) {
  return (
    <Link
      to={`/negocio/${business.id}`}
      className="group flex min-w-0 flex-col overflow-hidden rounded-[1.6rem] bg-card shadow-sm ring-1 ring-border/80 transition duration-200 hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="relative grid h-36 place-items-center overflow-hidden bg-gradient-to-br from-[#e7f5e9] via-[#f6f4e8] to-[#dcefe1] sm:h-40">
        <div className="absolute -right-7 -top-10 h-32 w-32 rounded-full border border-white/70" />
        <div className="absolute -bottom-12 -left-5 h-32 w-32 rounded-full border border-white/70" />
        <span className="relative drop-shadow-sm transition-transform duration-300 group-hover:scale-110" style={{ fontSize: "4.25rem" }}>
          {business.emoji}
        </span>
        <span className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold shadow-sm ${business.openNow ? "bg-white text-[#087c5b]" : "bg-foreground text-white"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${business.openNow ? "bg-[#0b9a62]" : "bg-white/60"}`} />
          {business.openNow ? "Abierto ahora" : "Cerrado"}
        </span>
        <span className="absolute bottom-3 right-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-extrabold text-foreground shadow-sm">
          {business.ratingCount > 0 ? `★ ${business.rating.toFixed(1)} (${business.ratingCount})` : "✦ Nuevo"}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="font-display text-base font-extrabold leading-tight group-hover:text-brand-dark">{business.name}</h3>
        <p className="line-clamp-1 text-xs font-medium text-muted-foreground">
          {CATEGORY_LABELS[business.category] ?? business.category} · {business.address}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs font-bold text-foreground/75">
          <span className="inline-flex items-center gap-1.5">🛵 {business.deliveryMinutes} min</span>
          <span className="rounded-full bg-[#edf7ef] px-2.5 py-1 text-[#176746]">Envío {money(business.deliveryFee)}</span>
        </div>
      </div>
    </Link>
  );
}

export function RescueCard({
  pack,
  business,
}: {
  pack: RescuePack & { reservable?: boolean };
  business: (Business & { openNow?: boolean }) | null;
}) {
  const discount = Math.round(
    (1 - pack.rescuePrice / pack.originalPrice) * 100,
  );
  const inner = (
    <div className="group relative flex gap-3 overflow-hidden rounded-[1.4rem] bg-card p-3 shadow-sm ring-1 ring-border/80 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-rescue-soft sm:h-28 sm:w-28">
        {pack.imageUrl ? <img src={pack.imageUrl} alt={pack.title} loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-4xl">{business?.emoji ?? "🎁"}</div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-sm font-extrabold leading-tight">
            {pack.title}
          </h3>
          <span className="shrink-0 rounded-full bg-rescue px-2 py-0.5 text-[11px] font-extrabold text-white">
            −{discount}%
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
          {business?.name} · retiro {packDayLabel(pack.pickupStart, pack.pickupEnd, pack.expiresAt)} {pack.pickupStart}–{pack.pickupEnd}
        </p>
        {business && business.openNow !== undefined && (
          <span className={`mt-1 inline-flex items-center gap-1 text-[11px] font-extrabold ${business.openNow ? "text-brand-dark" : "text-muted-foreground"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${business.openNow ? "bg-brand" : "bg-muted-foreground"}`} />
            {business.openNow ? "Local abierto" : "Local cerrado"}
          </span>
        )}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-lg font-extrabold text-rescue">
              {money(pack.rescuePrice)}
            </span>
            <span className="text-xs font-semibold text-muted-foreground line-through">
              {money(pack.originalPrice)}
            </span>
          </div>
          <span className={`text-[11px] font-bold ${pack.reservable === false ? "text-destructive" : "text-muted-foreground"}`}>
            {pack.reservable === false ? "Retiro terminado" : `${pack.quantityLeft} disp.`}
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
