import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { BUSINESS_CATEGORIES, MILAGRO } from "@contracts/constants";
import { BusinessCard, RescueCard } from "@/components/cards";

export default function Home() {
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const businesses = trpc.catalog.businesses.useQuery(
    { category: category ?? undefined, query: query || undefined },
    { staleTime: 30_000 },
  );
  const rescue = trpc.catalog.rescuePacks.useQuery(undefined, {
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      {/* Hero compacto */}
      <section className="overflow-hidden rounded-3xl bg-brand px-5 py-6 text-white md:px-8 md:py-8">
        <p className="text-xs font-extrabold uppercase tracking-widest text-white/70">
          📍 {MILAGRO.name}
        </p>
        <h1 className="font-display mt-1 text-2xl font-extrabold leading-tight md:text-4xl">
          ¿Qué te provoca hoy, Milagro?
        </h1>
        <p className="mt-1 max-w-md text-sm font-semibold text-white/85">
          Pide a domicilio en tus locales de siempre o{" "}
          <Link to="/rescate" className="underline decoration-2 underline-offset-2">
            rescata packs con descuento
          </Link>{" "}
          antes de que cierren.
        </p>
        {/* Buscador */}
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm">
          <span>🔎</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pollo broaster, ceviche, pan de ambato…"
            className="w-full bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </section>

      {/* Categorías */}
      <section className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button
          onClick={() => setCategory(null)}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ring-1 transition-colors ${
            category === null
              ? "bg-foreground text-white ring-foreground"
              : "bg-card text-foreground ring-border"
          }`}
        >
          Todo
        </button>
        {BUSINESS_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(category === c.id ? null : c.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ring-1 transition-colors ${
              category === c.id
                ? "bg-foreground text-white ring-foreground"
                : "bg-card text-foreground ring-border"
            }`}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </section>

      {/* Rescate destacado */}
      {!category && !query && (rescue.data?.length ?? 0) > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="font-display text-lg font-extrabold">
                🧡 Rescates de hoy
              </h2>
              <p className="text-xs font-semibold text-muted-foreground">
                Comida rica al final del día, hasta con 60% de descuento
              </p>
            </div>
            <Link
              to="/rescate"
              className="text-sm font-extrabold text-rescue hover:underline"
            >
              Ver todos →
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {rescue.data!.slice(0, 4).map(({ pack, business }) => (
              <RescueCard key={pack.id} pack={pack} business={business} />
            ))}
          </div>
        </section>
      )}

      {/* Comercios */}
      <section>
        <h2 className="font-display mb-3 text-lg font-extrabold">
          {category
            ? `${BUSINESS_CATEGORIES.find((c) => c.id === category)?.emoji ?? ""} ${
                BUSINESS_CATEGORIES.find((c) => c.id === category)?.label ?? ""
              }`
            : query
              ? `Resultados para “${query}”`
              : "Locales en Milagro"}
        </h2>
        {businesses.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-52 animate-pulse rounded-3xl bg-muted" />
            ))}
          </div>
        ) : (businesses.data?.length ?? 0) === 0 ? (
          <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">
            <p className="text-4xl">🔍</p>
            <p className="mt-2 font-display font-bold">No encontramos locales</p>
            <p className="text-sm text-muted-foreground">
              Prueba con otra búsqueda o categoría
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {businesses.data!.map((b) => (
              <BusinessCard key={b.id} business={b} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
