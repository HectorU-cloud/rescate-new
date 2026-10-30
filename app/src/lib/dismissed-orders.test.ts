import { describe, expect, it } from "vitest";
import { addDismissed, parseDismissed, pruneDismissed } from "./dismissed-orders";

describe("pedidos ocultos del repartidor", () => {
  it("lee el almacenamiento aunque esté vacío o dañado", () => {
    expect(parseDismissed(null)).toEqual([]);
    expect(parseDismissed("no es json")).toEqual([]);
    expect(parseDismissed('{"a":1}')).toEqual([]);
    expect(parseDismissed('[3,"x",-1,4.5,7]')).toEqual([3, 7]);
  });
  it("agrega sin duplicar", () => {
    expect(addDismissed([1, 2], 2)).toEqual([1, 2]);
    expect(addDismissed([1, 2], 3)).toEqual([1, 2, 3]);
  });
  it("conserva como máximo los 200 más recientes", () => {
    const many = Array.from({ length: 200 }, (_, i) => i + 1);
    const next = addDismissed(many, 999);
    expect(next).toHaveLength(200);
    expect(next[0]).toBe(2);
    expect(next.at(-1)).toBe(999);
  });
  it("olvida los pedidos que ya no están disponibles", () => {
    expect(pruneDismissed([1, 2, 3], [2, 3, 4])).toEqual([2, 3]);
  });
});
