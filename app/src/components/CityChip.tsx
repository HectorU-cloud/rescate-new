import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, LocateFixed, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useCity, type CityController } from "@/hooks/useCity";
import { useTourPending } from "@/hooks/useTourSeen";
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
 *
 * Dos usos:
 *  - "browse" (por defecto): la ciudad de navegación del cliente. Se recuerda en el dispositivo; se puede elegir "todas".
 *  - "work": la ciudad donde trabaja un repartidor. Es obligatoria (no hay "todas"), no se puede saltar y se guarda
 *    en el servidor a través del `controller` que se le pase.
 */
type Props = {
  className?: string;
  mode?: "browse" | "work";
  /** Quién decide la ciudad. Por defecto, la de navegación del cliente. */
  controller?: CityController;
  /** "dark" para encabezados de color; "light" para fondos claros. */
  tone?: "dark" | "light";
};

export default function CityChip({ className = "", mode = "browse", controller, tone = "dark" }: Props) {
  const browse = useCity();
  const { city, hasChosen, setCity, detect } = controller ?? browse;
  const work = mode === "work";
  // Si a esta persona aún le toca la guía de bienvenida, la pregunta de la ciudad espera a que termine (no se encima una ventana con otra).
  const tourPending = useTourPending(work ? "courier" : "customer");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("ask");
  const [notice, setNotice] = useState<string | null>(null);
  const counts = trpc.catalog.cityCounts.useQuery(undefined, { enabled: open && !work, staleTime: 5 * 60_000 });

  // La primera vez, se le pregunta.
  useEffect(() => {
    if (!hasChosen && !tourPending) {
      setView("ask");
      setOpen(true);
    }
  }, [hasChosen, tourPending]);

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
    // (Un repartidor no puede saltarlo: sin ciudad no ve pedidos, y el panel se lo recuerda.)
    if (!hasChosen && !work) setCity(null, "skipped");
    setOpen(false);
  };

  const choose = (cityId: string | null) => {
    setCity(cityId, "manual");
    setOpen(false);
    const name = cityById(cityId)?.name ?? "tu ciudad";
    toast.success(work ? `Trabajas en ${name}` : cityId ? `Mostrando locales de ${name}` : "Mostrando todas las ciudades");
  };

  const locate = async () => {
    setNotice(null);
    setView("detecting");
    const result = await detect();
    if (result.status === "ok") {
      setOpen(false);
      toast.success(work ? `Trabajas en ${result.city.name} 📍` : `Estás en ${result.city.name} 📍`);
      return;
    }
    setView("pick");
    setNotice(
      result.status === "outside"
        ? `Parece que estás fuera de nuestras zonas de servicio (la más cercana es ${result.nearest.name}). ${work ? "Elige tu ciudad de trabajo." : "Elige una ciudad o mira todas."}`
        : GEO_FAILURE_MESSAGES[result.status],
    );
  };

  const title =
    view === "detecting" ? "Buscando tu ubicación…"
    : view === "ask" ? (work ? "¿En qué ciudad vas a repartir?" : "¿En qué ciudad estás?")
    : work ? "Elige tu ciudad de trabajo" : "Elige tu ciudad";
  const description =
    view === "detecting" ? "Acepta el permiso si tu navegador te lo pide."
    : work ? "Verás —y recibirás avisos de— los pedidos de los locales de esa ciudad."
    : view === "ask" ? "Así te mostramos los locales y rescates de tu ciudad."
    : "Verás los locales y rescates de la ciudad que elijas.";
  const label = work ? (city ? `Trabajas en ${city.name}` : "Elige tu ciudad de trabajo") : cityLabel(city);
  const tones = tone === "light"
    ? "border-border bg-card text-foreground hover:bg-secondary"
    : "border-white/20 bg-white/10 text-white/90 backdrop-blur-sm hover:bg-white/20";

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        aria-label={`${label}. Toca para cambiarla`}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${tones} ${className}`}
      >
        <MapPin size={14} /> {label} <ChevronDown size={14} />
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
              {!work && (
                <button type="button" onClick={() => onOpenChange(false)} className="w-full rounded-2xl px-4 py-2.5 text-xs font-bold text-muted-foreground underline underline-offset-4">
                  Ahora no, ver todas las ciudades
                </button>
              )}
              <p className="pt-1 text-[11px] leading-4 text-muted-foreground">
                {work
                  ? "🔒 Tu ubicación solo se usa en tu dispositivo para saber tu ciudad. Guardamos únicamente el nombre de la ciudad, no tu ubicación."
                  : "🔒 Tu ubicación solo se usa en tu dispositivo para saber tu ciudad. No la guardamos ni la enviamos."}
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
                        {!work && (
                          <span className="text-[11px] font-bold text-muted-foreground">
                            {n === undefined ? "" : n === 0 ? "Próximamente" : `${n} local${n === 1 ? "" : "es"}`}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!work && (
                <button
                  type="button"
                  onClick={() => choose(null)}
                  aria-pressed={hasChosen && city === null}
                  className={`w-full rounded-2xl px-4 py-3 text-sm font-extrabold ring-1 transition hover:brightness-95 ${hasChosen && city === null ? "bg-brand-soft text-brand-dark ring-brand" : "bg-card ring-border"}`}
                >
                  🌎 Todas las ciudades
                </button>
              )}
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
