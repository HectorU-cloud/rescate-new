import { describe, expect, it } from "vitest";
import { computeBalance, computePendingPayments, debtState, type WalletEntryLike } from "@contracts/wallet";

const e = (entryType: WalletEntryLike["entryType"], amount: number, status: WalletEntryLike["status"] = "confirmed"): WalletEntryLike => ({ entryType, amount, status });

describe("saldo del estado de cuenta", () => {
  it("suma cargos y resta pagos confirmados", () => {
    expect(computeBalance([e("charge", 0.45), e("charge", 0.45), e("payment", 0.5)])).toBe(0.4);
  });
  it("ignora pagos pendientes y rechazados (hasta que el admin los confirme)", () => {
    expect(computeBalance([e("charge", 3), e("payment", 3, "pending"), e("payment", 3, "rejected")])).toBe(3);
    expect(computePendingPayments([e("payment", 3, "pending"), e("payment", 2, "confirmed"), e("charge", 9, "pending")])).toBe(3);
  });
  it("los ajustes suman (pueden ser negativos) y no hay error de coma flotante", () => {
    expect(computeBalance([e("charge", 0.1), e("charge", 0.2), e("adjustment", -0.05)])).toBe(0.25);
  });
  it("sin movimientos el saldo es 0", () => expect(computeBalance([])).toBe(0));
});

describe("estado de la deuda frente al límite", () => {
  it("sin deuda o por debajo del 80% está bien", () => {
    expect(debtState(0, 5)).toBe("ok");
    expect(debtState(-2, 5)).toBe("ok"); // saldo a favor
    expect(debtState(3.9, 5)).toBe("ok");
  });
  it("desde el 80% del límite avisa", () => {
    expect(debtState(4, 5)).toBe("warning");
    expect(debtState(5, 5)).toBe("warning"); // en el límite todavía no bloquea
  });
  it("bloquea cuando la deuda supera el límite", () => {
    expect(debtState(5.01, 5)).toBe("blocked");
  });
  it("un límite de 0 (o negativo) desactiva el bloqueo", () => {
    expect(debtState(999, 0)).toBe("ok");
    expect(debtState(999, -1)).toBe("ok");
  });
});
