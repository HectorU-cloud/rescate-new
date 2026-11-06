import { describe, expect, it } from "vitest";
import { describeOptions, isGroupOrderable, optionLineKey, resolveOptionSelection, type OptionGroupInfo } from "@contracts/options";

const papas: OptionGroupInfo = {
  id: 1, name: "Papas", minSelect: 1, maxSelect: 1,
  choices: [{ id: 11, name: "Pequeñas", priceDelta: 0 }, { id: 12, name: "Grandes", priceDelta: 1 }],
};
const cola: OptionGroupInfo = {
  id: 2, name: "Cola", minSelect: 1, maxSelect: 1,
  choices: [{ id: 21, name: "Coca-Cola", priceDelta: 0 }, { id: 22, name: "Fanta", priceDelta: 0 }, { id: 23, name: "Coca-Cola grande", priceDelta: 0.75 }, { id: 24, name: "Sprite", priceDelta: 0, isAvailable: false }],
};
const extras: OptionGroupInfo = {
  id: 3, name: "Extras", minSelect: 0, maxSelect: 2,
  choices: [{ id: 31, name: "Chorizo", priceDelta: 0.5 }, { id: 32, name: "Queso", priceDelta: 0.35 }, { id: 33, name: "Tocino", priceDelta: 0.6 }],
};
const combo = [papas, cola, extras];

describe("resolveOptionSelection", () => {
  it("suma solo los adicionales de lo elegido (lo incluido no cuesta)", () => {
    const r = resolveOptionSelection(combo, [11, 22]);
    expect(r).toMatchObject({ ok: true, extra: 0 });
  });
  it("papas grandes + cola agrandada + chorizo = 1 + 0.75 + 0.5", () => {
    const r = resolveOptionSelection(combo, [31, 23, 12]);
    expect(r.ok && r.extra).toBe(2.25);
    // devuelve las opciones en el orden de los grupos, no en el que llegaron
    expect(r.ok && r.options.map((o) => o.choiceId)).toEqual([12, 23, 31]);
  });
  it("evita errores de coma flotante (0.1 + 0.2)", () => {
    const g: OptionGroupInfo = { id: 9, name: "X", minSelect: 0, maxSelect: 2, choices: [{ id: 91, name: "a", priceDelta: 0.1 }, { id: 92, name: "b", priceDelta: 0.2 }] };
    const r = resolveOptionSelection([g], [91, 92]);
    expect(r.ok && r.extra).toBe(0.3);
  });
  it("exige los grupos obligatorios", () => {
    expect(resolveOptionSelection(combo, [11])).toEqual({ ok: false, message: "Elige una opción en «Cola»" });
    expect(resolveOptionSelection(combo, [])).toMatchObject({ ok: false });
  });
  it("no deja pasarse del máximo del grupo", () => {
    expect(resolveOptionSelection(combo, [11, 21, 12])).toMatchObject({ ok: false });
    expect(resolveOptionSelection(combo, [11, 21, 31, 32, 33])).toEqual({ ok: false, message: "En «Extras» puedes elegir máximo 2" });
  });
  it("rechaza opciones agotadas, ajenas o repetidas", () => {
    expect(resolveOptionSelection(combo, [11, 24])).toMatchObject({ ok: false });
    expect(resolveOptionSelection(combo, [11, 21, 999])).toMatchObject({ ok: false });
    expect(resolveOptionSelection(combo, [11, 21, 21])).toEqual({ ok: false, message: "Hay opciones repetidas" });
  });
  it("un producto sin grupos acepta solo una selección vacía", () => {
    expect(resolveOptionSelection([], [])).toEqual({ ok: true, options: [], extra: 0 });
    expect(resolveOptionSelection([], [5])).toMatchObject({ ok: false });
  });
});

describe("isGroupOrderable", () => {
  it("un grupo obligatorio con todo agotado bloquea el pedido; uno opcional no", () => {
    const agotado: OptionGroupInfo = { ...cola, choices: cola.choices.map((c) => ({ ...c, isAvailable: false })) };
    expect(isGroupOrderable(agotado)).toBe(false);
    expect(isGroupOrderable({ ...extras, choices: [] })).toBe(true);
    expect(isGroupOrderable(cola)).toBe(true);
  });
});

describe("optionLineKey", () => {
  it("sin opciones es el id del producto; con opciones no depende del orden", () => {
    expect(optionLineKey(7, [])).toBe("7");
    expect(optionLineKey(7, [23, 12])).toBe(optionLineKey(7, [12, 23]));
    expect(optionLineKey(7, [12, 23])).not.toBe(optionLineKey(7, [12, 22]));
  });
});

describe("describeOptions", () => {
  it("agrupa por grupo y muestra el adicional", () => {
    const money = (n: number) => `$${n.toFixed(2)}`;
    expect(describeOptions([
      { groupName: "Papas", choiceName: "Pequeñas", priceDelta: 0 },
      { groupName: "Extras", choiceName: "Chorizo", priceDelta: 0.5 },
      { groupName: "Extras", choiceName: "Queso", priceDelta: 0.35 },
    ], money)).toBe("Papas: Pequeñas · Extras: Chorizo (+$0.50), Queso (+$0.35)");
  });
});
