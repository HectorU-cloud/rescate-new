import { describe, expect, it } from "vitest";
import { parseNumberInput, rangeError } from "@contracts/number-input";

describe("parseNumberInput", () => {
  it("vacío o texto inválido es NaN (ya no se convierte en 0)", () => {
    expect(parseNumberInput("")).toBeNaN();
    expect(parseNumberInput("   ")).toBeNaN();
    expect(parseNumberInput("abc")).toBeNaN();
  });
  it("acepta punto y coma decimal", () => {
    expect(parseNumberInput("0.25")).toBe(0.25);
    expect(parseNumberInput("0,25")).toBe(0.25);
    expect(parseNumberInput(" 5 ")).toBe(5);
    expect(parseNumberInput("0")).toBe(0);
  });
});

describe("rangeError", () => {
  it("pide un valor cuando está vacío y valida el rango", () => {
    expect(rangeError("", 0, 20, "fuera")).toBe("Escribe un valor.");
    expect(rangeError("0", 0, 20, "fuera")).toBeNull();
    expect(rangeError("20", 0, 20, "fuera")).toBeNull();
    expect(rangeError("21", 0, 20, "fuera")).toBe("fuera");
    expect(rangeError("-1", 0, 20, "fuera")).toBe("fuera");
  });
});
