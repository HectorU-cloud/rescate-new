import { describe, expect, it } from "vitest";
import { normalizeEcuadorMobile, normalizeEcuadorPhone } from "@contracts/phone";

describe("normalizeEcuadorMobile", () => {
  it("acepta el formato local y lo deja igual", () => {
    expect(normalizeEcuadorMobile("0991234567")).toBe("0991234567");
  });
  it("acepta separadores y espacios alrededor", () => {
    expect(normalizeEcuadorMobile("  099 123-4567 ")).toBe("0991234567");
    expect(normalizeEcuadorMobile("(099) 123.4567")).toBe("0991234567");
  });
  it("acepta sin el cero inicial y con prefijo de país", () => {
    expect(normalizeEcuadorMobile("991234567")).toBe("0991234567");
    expect(normalizeEcuadorMobile("+593 99 123 4567")).toBe("0991234567");
    expect(normalizeEcuadorMobile("593991234567")).toBe("0991234567");
    expect(normalizeEcuadorMobile("+593 0991234567")).toBe("0991234567");
  });
  it("rechaza vacíos, letras, largos incorrectos y números que no son celular", () => {
    for (const bad of ["", "   ", "abc", "09912345", "09912345678", "0891234567", "042123456", "099123456a", "+1 305 123 4567"]) {
      expect(normalizeEcuadorMobile(bad)).toBeNull();
    }
  });
});

describe("normalizeEcuadorPhone", () => {
  it("acepta celulares y convencionales", () => {
    expect(normalizeEcuadorPhone("0991234567")).toBe("0991234567");
    expect(normalizeEcuadorPhone("042123456")).toBe("042123456");
    expect(normalizeEcuadorPhone("04 212-3456")).toBe("042123456");
    expect(normalizeEcuadorPhone("+593 4 212 3456")).toBe("042123456");
    expect(normalizeEcuadorPhone("42123456")).toBe("042123456");
  });
  it("rechaza números inválidos", () => {
    for (const bad of ["", "12345", "0012345678", "08212345", "abc"]) expect(normalizeEcuadorPhone(bad)).toBeNull();
  });
});
