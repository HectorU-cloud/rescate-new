// Opciones de producto (combos configurables). Compartido entre frontend y backend:
// el cliente usa estas funciones para mostrar el precio mientras elige y el servidor las usa
// para validar lo elegido y recalcular el precio (el servidor nunca confía en el precio del cliente).

export type OptionChoiceInfo = { id: number; name: string; priceDelta: number; isAvailable?: boolean };

export type OptionGroupInfo = {
  id: number;
  name: string;
  /** 0 = opcional; 1 o más = el cliente debe elegir al menos esa cantidad. */
  minSelect: number;
  /** 1 = una sola opción (radio); más de 1 = varias (casillas). */
  maxSelect: number;
  choices: OptionChoiceInfo[];
};

export type ResolvedOption = {
  groupId: number;
  groupName: string;
  choiceId: number;
  choiceName: string;
  priceDelta: number;
};

export type OptionResolution =
  | { ok: true; options: ResolvedOption[]; extra: number }
  | { ok: false; message: string };

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Valida las opciones elegidas (`chosenIds` = ids de opciones) contra los grupos del producto y calcula el
 * adicional. Falla si falta un grupo obligatorio, se pasa del máximo, repite una opción, elige una opción
 * agotada o una que no pertenece al producto.
 */
export function resolveOptionSelection(groups: OptionGroupInfo[], chosenIds: number[]): OptionResolution {
  if (new Set(chosenIds).size !== chosenIds.length) return { ok: false, message: "Hay opciones repetidas" };

  const owner = new Map<number, { group: OptionGroupInfo; choice: OptionChoiceInfo }>();
  for (const group of groups) for (const choice of group.choices) owner.set(choice.id, { group, choice });

  const picked = new Map<number, ResolvedOption[]>();
  for (const id of chosenIds) {
    const hit = owner.get(id);
    if (!hit) return { ok: false, message: "Una de las opciones elegidas ya no existe para este producto" };
    if (hit.choice.isAvailable === false) {
      return { ok: false, message: `«${hit.choice.name}» (${hit.group.name}) no está disponible por ahora` };
    }
    const list = picked.get(hit.group.id) ?? [];
    list.push({
      groupId: hit.group.id,
      groupName: hit.group.name,
      choiceId: hit.choice.id,
      choiceName: hit.choice.name,
      priceDelta: hit.choice.priceDelta,
    });
    picked.set(hit.group.id, list);
  }

  const options: ResolvedOption[] = [];
  for (const group of groups) {
    const list = picked.get(group.id) ?? [];
    if (list.length < group.minSelect) {
      return {
        ok: false,
        message: group.minSelect === 1 ? `Elige una opción en «${group.name}»` : `Elige al menos ${group.minSelect} opciones en «${group.name}»`,
      };
    }
    if (list.length > group.maxSelect) {
      return { ok: false, message: `En «${group.name}» puedes elegir máximo ${group.maxSelect}` };
    }
    // Se respeta el orden de las opciones del grupo, no el orden en que llegaron.
    for (const choice of group.choices) {
      const hit = list.find((o) => o.choiceId === choice.id);
      if (hit) options.push(hit);
    }
  }
  return { ok: true, options, extra: round2(options.reduce((a, o) => a + o.priceDelta, 0)) };
}

/** Un grupo obligatorio sin ninguna opción disponible vuelve imposible pedir el producto. */
export function isGroupOrderable(group: OptionGroupInfo): boolean {
  if (group.minSelect <= 0) return true;
  return group.choices.filter((c) => c.isAvailable !== false).length >= group.minSelect;
}

/**
 * Identifica una línea del carrito: el mismo producto con opciones distintas son líneas distintas
 * (un combo con Fanta y otro con Coca-Cola), y con las mismas opciones se junta en una sola.
 */
export function optionLineKey(productId: number, choiceIds: number[]): string {
  if (choiceIds.length === 0) return String(productId);
  return `${productId}:${[...choiceIds].sort((a, b) => a - b).join("-")}`;
}

/** Texto corto para mostrar lo elegido: «Papas: Pequeña · Cola: Fanta · Extras: Chorizo (+$0.50)». */
export function describeOptions(options: { groupName: string; choiceName: string; priceDelta: number }[], formatMoney: (n: number) => string): string {
  const byGroup = new Map<string, string[]>();
  for (const o of options) {
    const label = o.priceDelta > 0 ? `${o.choiceName} (+${formatMoney(o.priceDelta)})` : o.choiceName;
    byGroup.set(o.groupName, [...(byGroup.get(o.groupName) ?? []), label]);
  }
  return [...byGroup.entries()].map(([group, labels]) => `${group}: ${labels.join(", ")}`).join(" · ");
}
