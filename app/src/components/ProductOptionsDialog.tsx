import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money } from "@/lib/format";
import { resolveOptionSelection, round2, type OptionGroupInfo } from "@contracts/options";
import type { CartOption } from "@/hooks/useCart";

export type CustomizableProduct = {
  id: number;
  name: string;
  price: number;
  emoji: string;
  imageUrl: string | null;
  optionGroups: OptionGroupInfo[];
};

type Props = {
  product: CustomizableProduct | null;
  onClose: () => void;
  /** `unitPrice` ya incluye los adicionales de las opciones elegidas. */
  onAdd: (product: CustomizableProduct, options: CartOption[], unitPrice: number) => void;
};

/** Ventana para armar un combo: elegir sabor, tamaño y extras antes de agregarlo al carrito. */
export default function ProductOptionsDialog({ product, onClose, onAdd }: Props) {
  return (
    <Dialog open={product !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl p-0 sm:max-w-md">
        {/* Se monta de nuevo por producto: así cada vez empieza sin elecciones. */}
        {product && <OptionsForm key={product.id} product={product} onAdd={onAdd} />}
      </DialogContent>
    </Dialog>
  );
}

function OptionsForm({ product, onAdd }: { product: CustomizableProduct; onAdd: Props["onAdd"] }) {
  // groupId -> ids de las opciones elegidas
  const [picked, setPicked] = useState<Record<number, number[]>>({});
  const groups = product.optionGroups;
  const chosenIds = groups.flatMap((g) => picked[g.id] ?? []);
  const resolution = resolveOptionSelection(groups, chosenIds);
  const unitPrice = resolution.ok ? round2(product.price + resolution.extra) : round2(product.price);

  function toggle(group: OptionGroupInfo, choiceId: number) {
    setPicked((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelect === 1) return { ...prev, [group.id]: current[0] === choiceId && group.minSelect === 0 ? [] : [choiceId] };
      if (current.includes(choiceId)) return { ...prev, [group.id]: current.filter((id) => id !== choiceId) };
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, choiceId] };
    });
  }

  function submit() {
    if (!resolution.ok) return;
    onAdd(
      product,
      resolution.options.map((o) => ({ choiceId: o.choiceId, groupName: o.groupName, choiceName: o.choiceName, priceDelta: o.priceDelta })),
      unitPrice,
    );
  }

  return (
    <>
      <DialogHeader className="space-y-1 px-5 pb-0 pt-5 text-left">
        <DialogTitle className="font-display pr-6 text-xl font-extrabold leading-tight">
          {product.emoji} {product.name}
        </DialogTitle>
        <DialogDescription className="text-xs font-semibold">
          Base {money(product.price)} · elige cómo lo quieres
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 px-5">
        {groups.map((group) => {
          const selected = picked[group.id] ?? [];
          const single = group.maxSelect === 1;
          const full = !single && selected.length >= group.maxSelect;
          return (
            <fieldset key={group.id} className="space-y-2">
              <legend className="flex w-full items-center justify-between gap-2 pb-1">
                <span className="font-display text-sm font-extrabold">{group.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${group.minSelect > 0 ? "bg-brand text-white" : "bg-secondary text-muted-foreground"}`}>
                  {group.minSelect > 0 ? "Obligatorio" : single ? "Opcional" : `Opcional · hasta ${group.maxSelect}`}
                </span>
              </legend>
              {group.choices.map((choice) => {
                const isOn = selected.includes(choice.id);
                const soldOut = choice.isAvailable === false;
                const blocked = soldOut || (!isOn && full);
                return (
                  <label
                    key={choice.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 text-sm font-semibold transition ${isOn ? "border-brand bg-brand-soft" : "border-border"} ${blocked ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <input
                      type={single ? "radio" : "checkbox"}
                      name={`group-${group.id}`}
                      checked={isOn}
                      disabled={blocked}
                      // El radio se vuelve a tocar para quitarlo si el grupo es opcional.
                      onChange={() => toggle(group, choice.id)}
                      onClick={() => { if (single && isOn) toggle(group, choice.id); }}
                      className="h-4 w-4 shrink-0 accent-brand"
                    />
                    <span className="min-w-0 flex-1">{choice.name}</span>
                    <span className="shrink-0 text-xs font-extrabold text-muted-foreground">
                      {soldOut ? "Agotado" : choice.priceDelta > 0 ? `+${money(choice.priceDelta)}` : "Incluido"}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}
      </div>

      <div className="sticky bottom-0 space-y-2 border-t border-border bg-background px-5 pb-5 pt-3">
        {!resolution.ok && <p className="text-xs font-bold text-muted-foreground">{resolution.message}</p>}
        <button
          type="button"
          disabled={!resolution.ok}
          onClick={submit}
          className="flex w-full items-center justify-between rounded-full bg-brand px-5 py-3 text-sm font-extrabold text-white shadow-sm transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <span>Agregar al carrito</span>
          <span>{money(unitPrice)}</span>
        </button>
      </div>
    </>
  );
}
