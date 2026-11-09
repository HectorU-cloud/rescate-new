import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useTourPending } from "@/hooks/useTourSeen";
import { markTourSeen } from "@/lib/tour-state";
import { TOUR_FINISH, TOUR_STEPS, type TourRole } from "@/lib/tour-steps";

const SWIPE_PX = 50;

/**
 * Guía de bienvenida: una serie corta de tarjetas que explica la app a quien entra por primera vez.
 * Se muestra una sola vez por dispositivo y por rol; se puede saltar en cualquier momento y repetir desde el Perfil.
 * Se pone en la pantalla principal de cada rol (Inicio y Rescates, panel del local, panel del repartidor).
 */
export default function WelcomeTour({ role }: { role: TourRole }) {
  const open = useTourPending(role);
  const navigate = useNavigate();
  const steps = TOUR_STEPS[role];
  const finish = TOUR_FINISH[role];
  const [index, setIndex] = useState(0);
  const touchX = useRef<number | null>(null);

  const total = steps.length + 1; // los pasos + la tarjeta final
  const isFinal = index === steps.length;

  // Cada vez que se abre (la primera vez o al repetirla), empieza desde el principio.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const next = () => setIndex((i) => Math.min(i + 1, total - 1));
  const back = () => setIndex((i) => Math.max(i - 1, 0));
  const close = () => markTourSeen(role);
  const start = () => {
    markTourSeen(role);
    if (finish.goTo) navigate(finish.goTo);
  };

  const step = isFinal ? null : steps[index];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) close(); }}>
      <DialogContent
        showCloseButton={false}
        // Un toque fuera no la cierra por accidente: se sale con "Saltar guía" (o con Esc).
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md gap-0 overflow-hidden rounded-3xl p-0"
        onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const from = touchX.current;
          touchX.current = null;
          const to = e.changedTouches[0]?.clientX;
          if (from === null || to === undefined) return;
          if (to - from <= -SWIPE_PX) next();
          else if (to - from >= SWIPE_PX) back();
        }}
      >
        <div className="flex items-center justify-center bg-brand-soft px-6 pb-4 pt-8" aria-hidden="true">
          <span key={index} className="text-6xl animate-in fade-in zoom-in-90 duration-300 motion-reduce:animate-none">
            {step ? step.emoji : "🎉"}
          </span>
        </div>

        <div className="px-6 pb-2 pt-5" aria-live="polite">
          <div key={index} className="animate-in fade-in slide-in-from-right-3 duration-300 motion-reduce:animate-none">
            <DialogTitle className="font-display text-xl font-extrabold">{step ? step.title : finish.title}</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">{step ? step.body : finish.body}</DialogDescription>
            {step?.bullets && (
              <ul className="mt-3 space-y-2">
                {step.bullets.map((b) => (
                  <li key={b} className="flex gap-2 text-sm font-semibold leading-5">
                    <Check size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4 px-6 pb-6 pt-4">
          <p className="text-center text-[11px] font-bold text-muted-foreground">
            Paso {index + 1} de {total}
          </p>
          <ol className="flex justify-center gap-1.5" aria-label="Progreso de la guía">
            {Array.from({ length: total }, (_, i) => (
              <li
                key={i}
                aria-current={i === index ? "step" : undefined}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-brand" : i < index ? "w-1.5 bg-brand/50" : "w-1.5 bg-border"}`}
              />
            ))}
          </ol>

          {isFinal ? (
            <div className="space-y-2">
              <button type="button" onClick={start} className="w-full rounded-2xl bg-brand px-4 py-3.5 text-sm font-extrabold text-white shadow-sm transition hover:brightness-95">
                {finish.cta}
              </button>
              <button type="button" onClick={() => setIndex(0)} className="w-full rounded-2xl px-4 py-2.5 text-xs font-bold text-muted-foreground underline underline-offset-4">
                Ver la guía otra vez
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              {index === 0 ? (
                <button type="button" onClick={close} className="rounded-2xl px-3 py-3 text-xs font-bold text-muted-foreground underline underline-offset-4">
                  Saltar guía
                </button>
              ) : (
                <button type="button" onClick={back} className="rounded-2xl bg-secondary px-5 py-3 text-sm font-extrabold transition hover:brightness-95">
                  Atrás
                </button>
              )}
              <button type="button" onClick={next} className="rounded-2xl bg-brand px-6 py-3 text-sm font-extrabold text-white shadow-sm transition hover:brightness-95">
                {index === 0 ? "Empezar" : "Siguiente"}
              </button>
            </div>
          )}
          {!isFinal && index > 0 && (
            <button type="button" onClick={close} className="mx-auto block text-[11px] font-bold text-muted-foreground underline underline-offset-4">
              Saltar guía
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
