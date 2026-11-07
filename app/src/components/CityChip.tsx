import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, LocateFixed, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useCity } from "@/hooks/useCity";
import { CITIES, cityById, cityLabel } from "@contracts/cities";
import { GEO_FAILURE_MESSAGES } from "@/lib/geolocate";

type View = "ask" | "detecting" | "pick";

const primary = "flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:brightness-95";
const secondary = "w-full rounded-2xl bg-secondary px-4 py-3 text-sm font-extrabold transition hover:brightness-95";

/**
 * Botón con la ciudad actual (en el encabezado de Inicio y Rescates) y el diálogo para elegirla.
 * La primera vez que alguien entra se le pregunta; después se recuerda en su dispositivo.
 *
 * Privacidad: la ubicación del GPS se compara con nuestra lista de ciudades EN EL DISPOSITIVO.
 * Nunca se envía al servidor ni se guarda: solo se recuerda el id de la ciudad elegida.
 */
export default function CityChip({ className = "" }: { className?: string }) {
  const { city, hasChosen, setCity, detect } = useCity();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("ask");
  const [notice, setNotice] = useState<string | null>(null);
  const counts = trpc.catalog.cityCounts.useQuery(undefined, { enabled: open, staleTime: 5 * 60_000 });

  // La primera vez, se le pregunta.
  useEffect(() => {
    if (!hasChosen) {
      setView("ask");
      setOpen(true);
    }
  }, [hasChosen]);

  const countOf = (id: string) => counts.data?.find((c) => c.cityId === id)?.businesses;

  // Con locales primero (de más a menos) y el resto en el orden de la lista. Mientras cargan los conteos, el orden original.
  const ordered = useMemo(
    () => [...CITIES].sort((a, b) => (counts.data ? (countOf(b.id) ?? 0) - (countOf(a.id) ?? 0) : 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [counts.data],
  );

  const openPicker = () => {
    setNotice(null);
    setView("pick");
    setOpen(true);
  };

  const onOpenChange = (next: boolean) => {
    if (next) return setOpen(true);
    // Cerrar sin elegir en la primera visita = no quiere filtrar: se muestran todas y no se le vuelve a preguntar.
    if (!hasChosen) setCity(null, "skipped");
    setOpen(false);
  };

  const choose = (cityId: string | null) => {
    setCity(cityId, "manual");
    setOpen(false);
    toast.success(cityId ? `Mostrando locales de ${cityById(cityId)?.name ?? "tu ciudad"}` : "Mostrando todas las ciudades");
  };

  const locate = async () => {
    setNotice(null);
    setView("detecting");
    const result = await detect();
    if (result.status === "ok") {
      setOpen(false);
      toast.success(`Estás en ${result.city.name} 📍`);
      return;
    }
    setView("pick");
    setNotice(
      result.status === "outside"
        ? `Parece que estás fuera de nuestras zonas de servicio (la más cercana es ${result.nearest.name}). Elige una ciudad o mira todas.`
        : GEO_FAILURE_MESSAGES[result.status],
    );
  };

  const title = view === "ask" ? "¿En qué ciudad estás?" : view === "detecting" ? "Buscando tu ubicación…" : "Elige tu ciudad";
  const description =
    view === "ask" ? "Así te mostramos los locales y rescates de tu ciudad." : view === "detecting" ? "Acepta el permiso si tu navegador te lo pide." : "Verás los locales y rescates de la ciudad que elijas.";

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        aria-label={`Ciudad: ${cityLabel(city)}. Toca para cambiarla`}
        className={`inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/90 backdrop-blur-sm transition hover:bg-white/20 ${className}`}
      >
        <MapPin size={14} /> {cityLabel(city)} <ChevronDown size={14} />
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-extrabold">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {view === "ask" && (
            <div className="space-y-2">
              <button type="button" onClick={() => void locate()} className={primary}>
                <LocateFixed size={17} /> Usar mi ubicación
              </button>
              <button type="button" onClick={openPicker} className={secondary}>Elegir mi ciudad</button>
              <button type="button" onClick={() => onOpenChange(false)} className="w-full rounded-2xl px-4 py-2.5 text-xs font-bold text-muted-foreground underline underline-offset-4">
                Ahora no, ver todas las ciudades
              </button>
              <p className="pt-1 text-[11px] leading-4 text-muted-foreground">
                🔒 Tu ubicación solo se usa en tu dispositivo para saber tu ciudad. No la guardamos ni la enviamos.
              </p>
            </div>
          )}

          {view === "detecting" && (
            <div className="flex items-center justify-center gap-3 py-8 text-sm font-bold text-muted-foreground" role="status">
              <Loader2 size={20} className="animate-spin" /> Un momento…
            </div>
          )}

          {view === "pick" && (
            <div className="space-y-3">
              {notice && (
                <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 ring-1 ring-amber-200">{notice}</p>
              )}
              <ul className="space-y-1.5">
                {ordered.map((c) => {
                  const n = countOf(c.id);
                  const selected = city?.id === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => choose(c.id)}
                        aria-pressed={selected}
                        className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-extrabold ring-1 transition hover:brightness-95 ${selected ? "bg-brand-soft text-brand-dark ring-brand" : "bg-card ring-border"}`}
                      >
                        <span className="flex items-center gap-2">
                          {selected ? <Check size={16} /> : <MapPin size={16} className="text-muted-foreground" />} {c.name}
                        </span>
                        <span className="text-[11px] font-bold text-muted-foreground">
                          {n === undefined ? "" : n === 0 ? "Próximamente" : `${n} local${n === 1 ? "" : "es"}`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => choose(null)}
                aria-pressed={hasChosen && city === null}
                className={`w-full rounded-2xl px-4 py-3 text-sm font-extrabold ring-1 transition hover:brightness-95 ${hasChosen && city === null ? "bg-brand-soft text-brand-dark ring-brand" : "bg-card ring-border"}`}
              >
                🌎 Todas las ciudades
              </button>
              <button type="button" onClick={() => void locate()} className={secondary}>
                <span className="inline-flex items-center justify-center gap-2"><LocateFixed size={16} /> Detectar mi ciudad con mi ubicación</span>
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
