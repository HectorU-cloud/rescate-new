import { describe, expect, it } from "vitest";
import { findNewIds } from "./new-orders";

describe("findNewIds", () => {
  it("la primera carga es línea base: no avisa aunque ya haya pedidos", () => {
    expect(findNewIds(null, [1, 2, 3])).toEqual([]);
  });
  it("avisa solo de los pedidos que antes no estaban", () => {
    expect(findNewIds(new Set([1, 2]), [1, 2, 3, 4])).toEqual([3, 4]);
  });
  it("no avisa si no hay novedades o si un pedido salió de pendiente", () => {
    expect(findNewIds(new Set([1, 2]), [1, 2])).toEqual([]);
    expect(findNewIds(new Set([1, 2]), [2])).toEqual([]);
  });
  it("con la lista vacía no avisa", () => {
    expect(findNewIds(new Set([1]), [])).toEqual([]);
    expect(findNewIds(new Set(), [])).toEqual([]);
  });
});
