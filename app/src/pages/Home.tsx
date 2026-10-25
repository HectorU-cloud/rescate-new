import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Search, MapPin, ChevronRight, Heart, Clock3, Leaf, Sparkles } from "lucide-react";
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
  const rescue = trpc.catalog.rescuePacks.useQuery(undefined, { staleTime: 30_000 });

  const sortedBusinesses = useMemo(() => {
    const rows = [...(businesses.data ?? [])];
    return rows.sort((a, b) => Number(b.openNow) - Number(a.openNow));
  }, [businesses.data]);

  const sortedRescue = useMemo(() => {
    const rows = [...(rescue.data ?? [])];
    return rows.sort((a, b) => Number(Boolean(b.business?.openNow)) - Number(Boolean(a.business?.openNow)));
  }, [rescue.data]);

  return (
    <div className="home-page space-y-8 md:space-y-10">
      <section className="home-hero relative isolate overflow-hidden rounded-[2rem] bg-[#073f36] px-5 py-6 text-white shadow-sm sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        <div className="hero-orb hero-orb-one" aria-hidden="true" />
        <div className="hero-orb hero-orb-two" aria-hidden="true" />
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/90 backdrop-blur-sm">
            <MapPin size={14} /> {MILAGRO.name}
          </div>
          <p className="mt-5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[.18em] text-[#a9e6cb]">
            <Leaf size={15} /> Bueno para ti, mejor para el planeta
          </p>
          <h1 className="font-display mt-2 max-w-xl text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl lg:text-5xl">
            Rescata comida rica. <span className="text-[#b8f2d0]">Ahorra de verdad.</span>
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-white/80 sm:text-base">
            Descubre tus locales favoritos, encuentra ofertas del día y ayuda a que los alimentos no se desperdicien.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <label className="flex min-h-12 flex-1 items-center gap-3 rounded-2xl bg-white px-4 text-foreground shadow-lg ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-[#a9e6cb]">
              <Search size={19} className="shrink-0 text-[#087c5b]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Busca pan, almuerzos, frutas…"
                aria-label="Buscar alimentos y locales"
                className="w-full min-w-0 bg-transparent py-3 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground"
              />
            </label>
            <Link to="/rescate" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#ff8a32] px-5 py-3 text-sm font-extrabold text-white shadow-lg transition hover:bg-[#f5791f]">
              <Heart size={17} /> Ver rescates <ChevronRight size={17} />
            </Link>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/75">
            <span className="inline-flex items-center gap-1.5"><Sparkles size={14} className="text-[#b8f2d0]" /> Ofertas especiales</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 size={14} className="text-[#b8f2d0]" /> Disponibilidad actualizada</span>
          </div>
        </div>
        <div className="hero-food-art pointer-events-none absolute bottom-[-24px] right-[-10px] hidden select-none lg:block" aria-hidden="true">
          <div className="food-art-plate">🥐</div>
          <div className="food-art-fruit">🥑</div>
          <div className="food-art-leaf">🌿</div>
        </div>
      </section>

      <section aria-label="Categorías de locales">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.15em] text-brand-dark">Explora a tu manera</p>
            <h2 className="font-display mt-1 text-xl font-extrabold sm:text-2xl">¿Qué se te antoja?</h2>
          </div>
          {category && <button onClick={() => setCategory(null)} className="text-xs font-bold text-brand-dark underline underline-offset-4">Ver todo</button>}
        </div>
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
          <button onClick={() => setCategory(null)} className={`category-pill ${category === null ? "category-pill-active" : ""}`}>
            <span className="category-emoji">🍽️</span><span>Todo</span>
          </button>
          {BUSINESS_CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCategory(category === c.id ? null : c.id)} className={`category-pill ${category === c.id ? "category-pill-active" : ""}`}>
              <span className="category-emoji">{c.emoji}</span><span>{c.label}</span>
            </button>
          ))}
        </div>
      </section>

      {!category && !query && (sortedRescue.length > 0) && (
        <section>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.15em] text-[#d85a12]">Aprovecha antes de que termine el día</p>
              <h2 className="font-display mt-1 text-xl font-extrabold sm:text-2xl">Rescates cerca de ti 🧡</h2>
              <p className="mt-1 text-sm text-muted-foreground">Tus favoritos, con precios que se sienten bien.</p>
            </div>
            <Link to="/rescate" className="mb-1 inline-flex shrink-0 items-center gap-1 text-sm font-extrabold text-brand-dark hover:underline">Ver todos <ChevronRight size={17}/></Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sortedRescue.slice(0, 6).map(({ pack, business }) => <RescueCard key={pack.id} pack={pack} business={business} />)}
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.15em] text-brand-dark">Descubre tu próximo favorito</p>
            <h2 className="font-display mt-1 text-xl font-extrabold sm:text-2xl">
              {category ? `${BUSINESS_CATEGORIES.find((c) => c.id === category)?.emoji ?? ""} ${BUSINESS_CATEGORIES.find((c) => c.id === category)?.label ?? "Locales"}` : query ? `Resultados para “${query}”` : "Locales cerca de ti"}
            </h2>
          </div>
          {!category && !query && <span className="hidden rounded-full bg-brand-soft px-3 py-1.5 text-xs font-extrabold text-brand-dark sm:inline-flex">Abiertos primero</span>}
        </div>
        {businesses.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 animate-pulse rounded-3xl bg-muted" />)}</div>
        ) : sortedBusinesses.length === 0 ? (
          <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border sm:p-12">
            <p className="text-4xl">🔎</p><p className="font-display mt-3 text-lg font-extrabold">No encontramos locales</p>
            <p className="mt-1 text-sm text-muted-foreground">Prueba con otra búsqueda o categoría.</p>
            <button onClick={() => { setQuery(""); setCategory(null); }} className="mt-4 rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white">Limpiar filtros</button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{sortedBusinesses.map((b) => <BusinessCard key={b.id} business={b} />)}</div>
        )}
      </section>
      <div className="rounded-3xl border border-[#b8dfca] bg-[#e9f7ee] px-5 py-5 sm:flex sm:items-center sm:justify-between sm:gap-5 sm:px-7">
        <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-xl shadow-sm">🌎</span><div><h3 className="font-display font-extrabold text-[#124c39]">Cada rescate cuenta</h3><p className="mt-1 max-w-xl text-sm leading-5 text-[#376653]">Ahorra en tus comidas y ayuda a reducir el desperdicio de alimentos en tu comunidad.</p></div></div>
        <Link to="/rescate" className="mt-4 inline-flex items-center gap-1 text-sm font-extrabold text-[#087c5b] sm:mt-0">Conocer los rescates <ChevronRight size={17}/></Link>
      </div>
    </div>
  );
}
