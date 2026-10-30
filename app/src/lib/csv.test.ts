import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("deja intactos los textos y números simples", () => {
    expect(csvCell("Pizzería Juan")).toBe("Pizzería Juan");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(null)).toBe("");
  });
  it("entrecomilla y duplica comillas cuando hace falta", () => {
    expect(csvCell('Local "El Rey", centro')).toBe('"Local ""El Rey"", centro"');
    expect(csvCell("línea1\nlínea2")).toBe('"línea1\nlínea2"');
  });
  it("neutraliza fórmulas de hoja de cálculo", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+593999")).toBe("'+593999");
    expect(csvCell("@cmd")).toBe("'@cmd");
    // un número negativo es número, no texto: no se toca
    expect(csvCell(-3.2)).toBe("-3.2");
  });
  it("arma filas con BOM y saltos de línea", () => {
    expect(toCsv([["a", "b"], [1, 2]])).toBe("\ufeffa,b\r\n1,2\r\n");
  });
});
