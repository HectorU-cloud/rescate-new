import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useDialogs } from "@/providers/dialogs";
import { money } from "@/lib/format";

type ChoiceForm = { name: string; price: string; isAvailable: boolean };
type GroupForm = { id: number | null; name: string; required: boolean; max: string; choices: ChoiceForm[] };

const emptyChoice = (): ChoiceForm => ({ name: "", price: "", isAvailable: true });
const emptyGroup = (): GroupForm => ({ id: null, name: "", required: true, max: "1", choices: [emptyChoice(), emptyChoice()] });

const input = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-semibold outline-none";

/**
 * Opciones de combos del local: grupos como «Sabor de la cola», «Tamaño de papas» o «Extras», cada uno con sus opciones y
 * el precio adicional que cobra ESTE local. Se arman una vez y se marcan en los productos que las usen.
 */
export default function OptionGroupsManager() {
  const utils = trpc.useUtils();
  const dialogs = useDialogs();
  const groups = trpc.business.optionGroups.useQuery();
  const [form, setForm] = useState<GroupForm | null>(null);

  const refresh = () => {
    utils.business.optionGroups.invalidate();
    utils.business.products.invalidate();
    utils.catalog.invalidate();
  };
  const save = trpc.business.upsertOptionGroup.useMutation({
    onSuccess: () => {
      toast.success(form?.id ? "Grupo de opciones actualizado" : "Grupo de opciones creado");
      setForm(null);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.business.deleteOptionGroup.useMutation({
    onSuccess: () => {
      toast.success("Grupo eliminado");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const clean = form
    ? form.choices
        .map((c) => ({ name: c.name.trim(), price: Number(c.price || 0), isAvailable: c.isAvailable }))
        .filter((c) => c.name.length > 0)
    : [];
  const maxSelect = form ? Math.max(1, Math.min(10, Math.floor(Number(form.max) || 1))) : 1;
  const valid = !!form && form.name.trim().length >= 2 && clean.length >= 1 && clean.every((c) => Number.isFinite(c.price) && c.price >= 0);

  function patchChoice(index: number, patch: Partial<ChoiceForm>) {
    setForm((f) => (f ? { ...f, choices: f.choices.map((c, i) => (i === index ? { ...c, ...patch } : c)) } : f));
  }

  return (
    <div className="space-y-3 rounded-3xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Opciones de combos</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Crea grupos como «Sabor de la cola», «Tamaño de papas» o «Extras» con tus precios, y márcalos en los productos que los usen.
          </p>
        </div>
        {!form && (
          <button type="button" onClick={() => setForm(emptyGroup())} className="shrink-0 rounded-full bg-foreground px-3 py-1.5 text-[11px] font-extrabold text-white">
            + Nuevo grupo
          </button>
        )}
      </div>

      {form && (
        <div className="space-y-3 rounded-2xl border border-input p-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{form.id ? "Editar grupo" : "Nuevo grupo"}</p>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
            placeholder="Nombre (ej. Sabor de la cola, Tamaño de papas, Extras)"
            maxLength={100}
            className={input}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={form.required}
                onChange={(e) => setForm((f) => (f ? { ...f, required: e.target.checked } : f))}
                className="h-4 w-4 accent-brand"
              />
              El cliente debe elegir
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              Máximo a elegir
              <input
                type="number"
                min={1}
                max={10}
                value={form.max}
                onChange={(e) => setForm((f) => (f ? { ...f, max: e.target.value } : f))}
                className="w-16 rounded-xl border border-input bg-background px-2 py-1.5 text-center text-sm font-semibold outline-none"
              />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sabor o tamaño: «debe elegir» y máximo 1. Extras: sin marcar «debe elegir» y máximo 2 o 3.
          </p>

          <div className="space-y-2">
            {form.choices.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={c.name}
                  onChange={(e) => patchChoice(i, { name: e.target.value })}
                  placeholder="Opción (ej. Fanta)"
                  maxLength={100}
                  className={input}
                />
                <input
                  value={c.price}
                  onChange={(e) => patchChoice(i, { price: e.target.value })}
                  placeholder="+$0.00"
                  type="number"
                  min={0}
                  step={0.05}
                  aria-label="Precio adicional (0 si está incluida)"
                  className="w-24 shrink-0 rounded-xl border border-input bg-background px-2 py-2.5 text-sm font-semibold outline-none"
                />
                <button
                  type="button"
                  onClick={() => patchChoice(i, { isAvailable: !c.isAvailable })}
                  className={`shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-extrabold ${c.isAvailable ? "bg-brand-soft text-brand-dark" : "bg-secondary text-muted-foreground"}`}
                >
                  {c.isAvailable ? "Hay" : "Agotado"}
                </button>
                <button
                  type="button"
                  aria-label="Quitar opción"
                  disabled={form.choices.length <= 1}
                  onClick={() => setForm((f) => (f ? { ...f, choices: f.choices.filter((_, idx) => idx !== i) } : f))}
                  className="shrink-0 px-1 text-lg font-bold text-destructive disabled:opacity-30"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={form.choices.length >= 30}
              onClick={() => setForm((f) => (f ? { ...f, choices: [...f.choices, emptyChoice()] } : f))}
              className="text-sm font-bold text-brand-dark"
            >
              + Agregar opción
            </button>
            <p className="text-[11px] text-muted-foreground">Deja el precio vacío o en 0 si la opción viene incluida.</p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!valid || save.isPending}
              onClick={() =>
                save.mutate({
                  ...(form.id ? { id: form.id } : {}),
                  name: form.name.trim(),
                  minSelect: form.required ? 1 : 0,
                  maxSelect,
                  choices: clean.map((c) => ({ name: c.name, priceDelta: c.price, isAvailable: c.isAvailable })),
                })
              }
              className="flex-1 rounded-xl bg-foreground py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
            >
              {save.isPending ? "Guardando…" : "Guardar grupo"}
            </button>
            <button type="button" onClick={() => setForm(null)} className="rounded-xl border border-input px-4 py-2.5 text-sm font-bold">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {(groups.data ?? []).map((g) => (
        <div key={g.id} className="flex items-start gap-3 rounded-2xl bg-secondary/50 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">{g.name}</p>
            <p className="text-[11px] font-bold text-muted-foreground">
              {g.minSelect > 0 ? "Obligatorio" : "Opcional"} · {g.maxSelect === 1 ? "elige 1" : `hasta ${g.maxSelect}`} · en {g.productCount} producto{g.productCount === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {g.choices
                .map((c) => `${c.name}${c.priceDelta > 0 ? ` (+${money(c.priceDelta)})` : ""}${c.isAvailable ? "" : " — agotado"}`)
                .join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setForm({
                id: g.id,
                name: g.name,
                required: g.minSelect > 0,
                max: String(g.maxSelect),
                choices: g.choices.map((c) => ({ name: c.name, price: c.priceDelta > 0 ? String(c.priceDelta) : "", isAvailable: c.isAvailable })),
              })
            }
            className="shrink-0 rounded-full border border-input px-3 py-1.5 text-[11px] font-extrabold"
          >
            Editar
          </button>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={async () => {
              const ok = await dialogs.confirm({
                title: `¿Eliminar «${g.name}»?`,
                description: g.productCount > 0
                  ? `Dejará de aparecer en ${g.productCount} producto${g.productCount === 1 ? "" : "s"}. Los pedidos ya hechos no cambian.`
                  : "Los pedidos ya hechos no cambian.",
                confirmLabel: "Eliminar",
                destructive: true,
              });
              if (ok) remove.mutate({ id: g.id });
            }}
            className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold text-destructive ring-1 ring-destructive/30"
          >
            Eliminar
          </button>
        </div>
      ))}

      {!form && (groups.data ?? []).length === 0 && !groups.isLoading && (
        <p className="rounded-2xl bg-secondary/50 p-3 text-xs text-muted-foreground">
          Ejemplo para un combo de hamburguesa: «Sabor de la cola» (obligatorio, elige 1: Coca-Cola, Fanta, Sprite), «Tamaño de papas» (Pequeñas incluidas, Grandes +$0.50) y «Extras» (opcional, hasta 3: Chorizo +$0.50, Queso +$0.35).
        </p>
      )}
    </div>
  );
}
