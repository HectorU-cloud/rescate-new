import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";

function Stars({ value, onChange, disabled }: { value: number; onChange?: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
          disabled={disabled}
          onClick={() => onChange?.(n)}
          className={`text-3xl leading-none transition-transform ${n <= value ? "text-amber-400" : "text-border"} ${disabled ? "" : "active:scale-90"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/** Calificación del cliente tras la entrega: comercio siempre; repartidor si hubo. */
export function RatingBox({ orderId, businessName, hasCourier }: { orderId: number; businessName?: string; hasCourier: boolean }) {
  const utils = trpc.useUtils();
  const existing = trpc.orders.myRating.useQuery({ orderId });
  const [businessStars, setBusinessStars] = useState(0);
  const [businessComment, setBusinessComment] = useState("");
  const [courierStars, setCourierStars] = useState(0);
  const [courierComment, setCourierComment] = useState("");
  const rate = trpc.orders.rate.useMutation({
    onSuccess: () => {
      toast.success("¡Gracias por tu calificación!");
      utils.orders.myRating.invalidate({ orderId });
      utils.catalog.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (existing.isLoading) return null;
  const done = existing.data;

  return (
    <section className="space-y-4 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
        {done ? "Tu calificación" : "¿Cómo te fue?"}
      </p>

      <div className="space-y-2">
        <p className="text-sm font-extrabold">{businessName ?? "El local"}</p>
        <Stars value={done ? done.businessStars : businessStars} onChange={setBusinessStars} disabled={!!done} />
        {done ? (
          done.businessComment && <p className="text-xs font-semibold text-muted-foreground">“{done.businessComment}”</p>
        ) : (
          <textarea
            value={businessComment}
            onChange={(e) => setBusinessComment(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Comentario opcional (comida, empaque, atención…)"
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
          />
        )}
      </div>

      {hasCourier && (
        <div className="space-y-2">
          <p className="text-sm font-extrabold">Repartidor</p>
          <Stars value={done ? done.courierStars ?? 0 : courierStars} onChange={setCourierStars} disabled={!!done} />
          {done ? (
            done.courierComment && <p className="text-xs font-semibold text-muted-foreground">“{done.courierComment}”</p>
          ) : (
            <textarea
              value={courierComment}
              onChange={(e) => setCourierComment(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Comentario opcional (puntualidad, trato…)"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
            />
          )}
        </div>
      )}

      {!done && (
        <button
          disabled={rate.isPending || businessStars === 0}
          onClick={() =>
            rate.mutate({
              orderId,
              businessStars,
              businessComment: businessComment.trim() || undefined,
              ...(hasCourier && courierStars > 0 ? { courierStars, courierComment: courierComment.trim() || undefined } : {}),
            })
          }
          className="w-full rounded-xl bg-foreground py-3 text-sm font-extrabold text-white disabled:opacity-50"
        >
          {rate.isPending ? "Enviando…" : "Enviar calificación"}
        </button>
      )}
    </section>
  );
}
