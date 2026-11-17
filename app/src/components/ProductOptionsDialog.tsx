import { useRef, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { money } from "@/lib/format";
import { firstUnmetGroupId, resolveOptionSelection, round2, selectionHint, type OptionGroupInfo } from "@contracts/options";
import type { CartOption } from "@/hooks/useCart";

export type CustomizableProduct = {
  id: number;
  name: string;
  description?: string | null;
  price: number;
  emoji: string;
  imageUrl: string | null;
  optionGroups: OptionGroupInfo[];
};

type Props = {
  product: CustomizableProduct | null;
  onClose: () => void;
  /** `add`: producto nuevo. `edit`: se cambia un combo que ya está en el carrito. */
  mode?: "add" | "edit";
  /** Opciones con las que arranca (al editar un combo del carrito). */
  initialChoiceIds?: number[];
  initialQuantity?: number;
  /** `unitPrice` ya incluye los adicionales de las opciones elegidas; el total es `unitPrice × quantity`. */
  onAdd: (product: CustomizableProduct, options: CartOption[], unitPrice: number, quantity: number) => void;
};

const MAX_QTY = 20;

/**
 * Hoja para armar un combo, al estilo de las apps de delivery: foto, grupos con «Obligatorio/Opcional» y cuántas
 * opciones se pueden elegir, adicionales con su precio, cantidad y total en el botón. En el celular sube desde abajo.
 */
export default function ProductOptionsDialog({ product, onClose, mode = "add", initialChoiceIds, initialQuantity, onAdd }: Props) {
  return (
    <Dialog open={product !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="fixed bottom-0 left-0 right-0 top-auto max-h-[92dvh] max-w-full translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-b-none rounded-t-3xl border-0 p-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:bottom-auto sm:left-[50%] sm:right-auto sm:top-[50%] sm:max-w-md sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-3xl"
      >
        {/* Se monta de nuevo por producto: así cada vez empieza desde cero (o desde lo que se está editando). */}
        {product && <OptionsForm key={product.id} product={product} mode={mode} initialChoiceIds={initialChoiceIds} initialQuantity={initialQuantity} onAdd={onAdd} />}
      </DialogContent>
    </Dialog>
  );
}

function startingPicks(groups: OptionGroupInfo[], ids: number[] | undefined): Record<number, number[]> {
  const picked: Record<number, number[]> = {};
  if (!ids?.length) return picked;
  for (const g of groups) {
    const hit = g.choices.filter((c) => ids.includes(c.id) && c.isAvailable !== false).map((c) => c.id).slice(0, g.maxSelect);
    if (hit.length) picked[g.id] = hit;
  }
  return picked;
}

function OptionsForm({ product, mode, initialChoiceIds, initialQuantity, onAdd }: { product: CustomizableProduct; mode: "add" | "edit"; initialChoiceIds?: number[]; initialQuantity?: number; onAdd: Props["onAdd"] }) {
  const groups = product.optionGroups;
  // groupId -> ids de las opciones elegidas
  const [picked, setPicked] = useState<Record<number, number[]>>(() => startingPicks(groups, initialChoiceIds));
  const [quantity, setQuantity] = useState(() => Math.min(MAX_QTY, Math.max(1, initialQuantity ?? 1)));
  // Tras intentar agregar con grupos obligatorios sin completar, se marcan en rojo.
  const [attempted, setAttempted] = useState(false);
  const groupRefs = useRef<Record<number, HTMLElement | null>>({});

  const chosenIds = groups.flatMap((g) => picked[g.id] ?? []);
  const resolution = resolveOptionSelection(groups, chosenIds);
  const unitPrice = resolution.ok ? round2(product.price + resolution.extra) : round2(product.price);
  const total = round2(unitPrice * quantity);
  const description = product.description?.trim();

  const scrollToGroup = (groupId: number) => {
    window.setTimeout(() => groupRefs.current[groupId]?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  };

  function toggle(group: OptionGroupInfo, choiceId: number) {
    const current = picked[group.id] ?? [];
    let next: number[];
    if (group.maxSelect === 1) {
      // En un grupo obligatorio no se puede dejar sin elegir; en uno opcional, tocar de nuevo lo quita.
      next = current[0] === choiceId ? (group.minSelect === 0 ? [] : current) : [choiceId];
    } else if (current.includes(choiceId)) {
      next = current.filter((id) => id !== choiceId);
    } else if (current.length >= group.maxSelect) {
      return;
    } else {
      next = [...current, choiceId];
    }
    const nextPicked = { ...picked, [group.id]: next };
    setPicked(nextPicked);
    // Como en las apps: al elegir una opción única obligatoria, te lleva al siguiente grupo que falta.
    if (group.maxSelect === 1 && next.length === 1 && current.length === 0) {
      const nextId = firstUnmetGroupId(groups, nextPicked);
      if (nextId != null && nextId !== group.id) scrollToGroup(nextId);
    }
  }

  function submit() {
    if (!resolution.ok) {
      setAttempted(true);
      const missing = firstUnmetGroupId(groups, picked);
      if (missing != null) scrollToGroup(missing);
      return;
    }
    onAdd(
      product,
      resolution.options.map((o) => ({ choiceId: o.choiceId, groupName: o.groupName, choiceName: o.choiceName, priceDelta: o.priceDelta })),
      unitPrice,
      quantity,
    );
  }

  return (
    <>
      {/* Foto y datos del producto */}
      <div className="relative h-44 shrink-0 overflow-hidden bg-gradient-to-br from-brand-soft to-secondary sm:h-48">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-7xl">{product.emoji}</div>
        )}
        <DialogClose
          aria-label="Cerrar"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/95 text-foreground shadow-md transition-transform active:scale-90"
        >
          <X className="h-4 w-4" />
        </DialogClose>
      </div>

      <div className="space-y-1 px-5 pb-3 pt-4">
        <DialogTitle className="font-display text-xl font-extrabold leading-tight">{product.name}</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-1">
            <p className="text-sm font-extrabold text-brand-dark">{money(product.price)}</p>
            {description && <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{description}</p>}
          </div>
        </DialogDescription>
      </div>

      <div className="space-y-4 bg-secondary/50 px-4 py-4">
        {groups.map((group) => {
          const selected = picked[group.id] ?? [];
          const single = group.maxSelect === 1;
          const required = group.minSelect > 0;
          const satisfied = selected.length >= group.minSelect;
          const full = !single && selected.length >= group.maxSelect;
          const problem = attempted && !satisfied;
          return (
            <section
              key={group.id}
              ref={(el) => { groupRefs.current[group.id] = el; }}
              aria-labelledby={`group-title-${group.id}`}
              className={`overflow-hidden rounded-2xl bg-card ring-1 transition ${problem ? "ring-2 ring-destructive" : "ring-border"}`}
            >
              <header className="flex items-start justify-between gap-3 px-4 pt-3.5">
                <div className="min-w-0">
                  <h3 id={`group-title-${group.id}`} className="font-display text-sm font-extrabold">{group.name}</h3>
                  <p className={`text-xs font-semibold ${problem ? "text-destructive" : "text-muted-foreground"}`}>
                    {problem ? "Falta elegir · " : ""}{selectionHint(group)}{!single && selected.length > 0 ? ` · ${selected.length}/${group.maxSelect}` : ""}
                  </p>
                </div>
                {required && satisfied ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-brand-dark">
                    <Check className="h-3 w-3" /> Listo
                  </span>
                ) : (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${required ? "bg-brand text-white" : "bg-secondary text-muted-foreground"}`}>
                    {required ? "Obligatorio" : "Opcional"}
                  </span>
                )}
              </header>
              <div role={single ? "radiogroup" : "group"} aria-labelledby={`group-title-${group.id}`} className="mt-1 divide-y divide-border px-4 pb-1">
                {group.choices.map((choice) => {
                  const isOn = selected.includes(choice.id);
                  const soldOut = choice.isAvailable === false;
                  const blocked = soldOut || (!isOn && full);
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      role={single ? "radio" : "checkbox"}
                      aria-checked={isOn}
                      disabled={blocked}
                      onClick={() => toggle(group, choice.id)}
                      className={`flex w-full items-center gap-3 py-3 text-left transition-opacity disabled:cursor-not-allowed ${blocked ? "opacity-45" : ""}`}
                    >
                      <span className={`min-w-0 flex-1 text-sm ${isOn ? "font-extrabold" : "font-semibold"}`}>{choice.name}</span>
                      <span className="shrink-0 text-xs font-extrabold text-muted-foreground">
                        {soldOut ? "Agotado" : choice.priceDelta > 0 ? `+${money(choice.priceDelta)}` : ""}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`grid h-6 w-6 shrink-0 place-items-center border-2 transition ${single ? "rounded-full" : "rounded-md"} ${isOn ? "border-brand bg-brand text-white" : "border-border bg-card"}`}
                      >
                        {isOn && (single ? <span className="h-2 w-2 rounded-full bg-white" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Cantidad + total */}
      <div className="sticky bottom-0 space-y-2 border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {attempted && !resolution.ok && (
          <p role="alert" className="text-center text-xs font-extrabold text-destructive">{resolution.message}</p>
        )}
        <div className="flex items-center gap-3">
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-secondary p-1" role="group" aria-label="Cantidad">
            <button
              type="button"
              aria-label="Una menos"
              disabled={quantity <= 1}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="grid h-9 w-9 place-items-center rounded-full bg-card shadow-sm transition-transform active:scale-90 disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-7 text-center text-sm font-extrabold" aria-live="polite">{quantity}</span>
            <button
              type="button"
              aria-label="Una más"
              disabled={quantity >= MAX_QTY}
              onClick={() => setQuantity((q) => Math.min(MAX_QTY, q + 1))}
              className="grid h-9 w-9 place-items-center rounded-full bg-card shadow-sm transition-transform active:scale-90 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={submit}
            className={`flex flex-1 items-center justify-between rounded-full bg-brand px-5 py-3 text-sm font-extrabold text-white shadow-sm transition-transform active:scale-[0.98] ${resolution.ok ? "" : "opacity-70"}`}
          >
            <span>{resolution.ok ? (mode === "edit" ? "Guardar cambios" : "Agregar") : "Completa tus opciones"}</span>
            <span>{money(total)}</span>
          </button>
        </div>
      </div>
    </>
  );
}
