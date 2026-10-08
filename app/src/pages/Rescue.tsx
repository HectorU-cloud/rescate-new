import { trpc } from "@/providers/trpc";
import { RescueCard } from "@/components/cards";

export default function Rescue() {
  const rescue = trpc.catalog.rescuePacks.useQuery(undefined, {
    staleTime: 30_000,
  });

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-rescue px-5 py-6 text-white md:px-8">
        <h1 className="font-display text-2xl font-extrabold leading-tight md:text-3xl">
          🧡 Rescata comida rica
        </h1>
        <p className="mt-1 max-w-md text-sm font-semibold text-white/90">
          Los locales publican al final del día lo que quedó fresquito, hasta
          con 60% de descuento. Reservas aquí, retiras en el local y pagas en
          efectivo.
        </p>
        <div className="mt-4 flex gap-4 text-xs font-extrabold">
          <span className="rounded-full bg-white/20 px-3 py-1.5">
            {rescue.data?.reduce((a, r) => a + r.pack.quantityLeft, 0) ?? 0} packs hoy
          </span>
          <span className="rounded-full bg-white/20 px-3 py-1.5">
            Menos desperdicio 🌱
          </span>
        </div>
      </section>

      {rescue.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-3xl bg-muted" />
          ))}
        </div>
      ) : (rescue.data?.length ?? 0) === 0 ? (
        <div className="rounded-3xl bg-card p-10 text-center ring-1 ring-border">
          <p className="text-5xl">😴</p>
          <p className="font-display mt-3 text-lg font-extrabold">
            Por ahora no hay packs
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Los locales publican cerca de la hora de cierre. Vuelve más tarde.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rescue.data!.map(({ pack, business }) => (
            <RescueCard key={pack.id} pack={pack} business={business} />
          ))}
        </div>
      )}
    </div>
  );
}
