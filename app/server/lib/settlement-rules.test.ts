import { describe, expect, it } from "vitest";
import {
  MAX_PERIOD_DAYS, buildStatements, computeBalance, computeStatement, effectiveTime, hasActivity,
  normalizePaymentReference, periodBounds, type DatedWalletEntry,
} from "@contracts/wallet";

const d = (iso: string) => new Date(iso);
const entry = (e: Partial<DatedWalletEntry> & Pick<DatedWalletEntry, "entryType" | "amount" | "createdAt">): DatedWalletEntry => ({ status: "confirmed", ...e });

describe("normalizePaymentReference", () => {
  it("quita espacios sobrantes pero conserva el texto", () => {
    expect(normalizePaymentReference("  TR   123 456 ")).toBe("TR 123 456");
    expect(normalizePaymentReference("abc")).toBe("abc");
  });
});

describe("periodBounds (hora de Ecuador, UTC-5)", () => {
  it("un mes completo va del 00:00 local del primer día al 00:00 local del día siguiente al último", () => {
    const { start, end, days } = periodBounds("2026-01-01", "2026-01-31");
    expect(start.toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-02-01T05:00:00.000Z");
    expect(days).toBe(31);
  });
  it("un solo día dura 24 horas y febrero bisiesto tiene 29 días", () => {
    expect(periodBounds("2026-03-10", "2026-03-10").days).toBe(1);
    expect(periodBounds("2028-02-01", "2028-02-29").days).toBe(29);
  });
  it("rechaza fechas inexistentes, mal escritas o al revés", () => {
    expect(() => periodBounds("2026-02-30", "2026-03-01")).toThrow(/formato/);
    expect(() => periodBounds("26-01-01", "2026-03-01")).toThrow(/formato/);
    expect(() => periodBounds("2026-03-05", "2026-03-04")).toThrow(/anterior/);
  });
  it("limita el período a un año", () => {
    expect(periodBounds("2026-01-01", "2027-01-01").days).toBe(366);
    expect(() => periodBounds("2026-01-01", "2027-01-02")).toThrow(String(MAX_PERIOD_DAYS));
  });
});

describe("effectiveTime", () => {
  it("un pago cuenta cuando se confirma; un cargo, cuando se creó", () => {
    expect(effectiveTime(entry({ entryType: "payment", amount: 1, createdAt: d("2026-01-02T00:00:00Z"), reviewedAt: d("2026-01-09T00:00:00Z") }))).toBe(d("2026-01-09T00:00:00Z").getTime());
    expect(effectiveTime(entry({ entryType: "charge", amount: 1, createdAt: d("2026-01-02T00:00:00Z"), reviewedAt: d("2026-01-09T00:00:00Z") }))).toBe(d("2026-01-02T00:00:00Z").getTime());
    expect(effectiveTime(entry({ entryType: "payment", amount: 1, createdAt: d("2026-01-02T00:00:00Z") }))).toBe(d("2026-01-02T00:00:00Z").getTime());
  });
});

describe("computeStatement", () => {
  const { start, end } = periodBounds("2026-03-01", "2026-03-31");
  const s = start.getTime(), e = end.getTime();

  it("separa saldo inicial, cargos, pagos y ajustes del período, y suma el saldo final", () => {
    const entries = [
      entry({ entryType: "charge", amount: 2, createdAt: d("2026-02-10T12:00:00Z") }), // antes: saldo inicial
      entry({ entryType: "charge", amount: 5, createdAt: d("2026-03-10T12:00:00Z") }),
      entry({ entryType: "charge", amount: 3, createdAt: d("2026-03-20T12:00:00Z") }),
      entry({ entryType: "payment", amount: 4, createdAt: d("2026-03-22T12:00:00Z"), reviewedAt: d("2026-03-25T12:00:00Z") }),
      entry({ entryType: "adjustment", amount: -1.5, createdAt: d("2026-03-26T12:00:00Z") }),
      entry({ entryType: "charge", amount: 9, createdAt: d("2026-04-02T12:00:00Z") }), // después: no cuenta
    ];
    expect(computeStatement(entries, s, e)).toEqual({ openingBalance: 2, charges: 8, payments: 4, adjustments: -1.5, closingBalance: 4.5, pendingPayments: 0 });
  });

  it("un pago reportado en el período pero confirmado después no reduce ese período", () => {
    const entries = [
      entry({ entryType: "charge", amount: 6, createdAt: d("2026-03-05T12:00:00Z") }),
      entry({ entryType: "payment", amount: 6, createdAt: d("2026-03-30T12:00:00Z"), reviewedAt: d("2026-04-03T12:00:00Z") }),
    ];
    const march = computeStatement(entries, s, e);
    expect(march.payments).toBe(0);
    expect(march.closingBalance).toBe(6);
    // y en abril sí: el saldo inicial es 6 y el pago lo salda
    const { start: a, end: b } = periodBounds("2026-04-01", "2026-04-30");
    expect(computeStatement(entries, a.getTime(), b.getTime())).toMatchObject({ openingBalance: 6, payments: 6, closingBalance: 0 });
  });

  it("los pagos por verificar son informativos y los rechazados no cuentan", () => {
    const entries = [
      entry({ entryType: "charge", amount: 5, createdAt: d("2026-03-05T12:00:00Z") }),
      entry({ entryType: "payment", amount: 2, status: "pending", createdAt: d("2026-03-06T12:00:00Z") }),
      entry({ entryType: "payment", amount: 3, status: "rejected", createdAt: d("2026-03-07T12:00:00Z"), reviewedAt: d("2026-03-08T12:00:00Z") }),
    ];
    expect(computeStatement(entries, s, e)).toMatchObject({ payments: 0, closingBalance: 5, pendingPayments: 2 });
  });

  it("el saldo final coincide con el saldo de siempre calculado hasta el fin del período", () => {
    const entries = [
      entry({ entryType: "charge", amount: 0.45, createdAt: d("2026-01-05T12:00:00Z") }),
      entry({ entryType: "charge", amount: 0.45, createdAt: d("2026-03-05T12:00:00Z") }),
      entry({ entryType: "payment", amount: 0.3, createdAt: d("2026-03-06T12:00:00Z"), reviewedAt: d("2026-03-07T12:00:00Z") }),
      entry({ entryType: "adjustment", amount: -0.1, createdAt: d("2026-03-08T12:00:00Z") }),
    ];
    expect(computeStatement(entries, s, e).closingBalance).toBe(computeBalance(entries));
  });

  it("el borde del período: el instante exacto del inicio entra y el del fin queda fuera", () => {
    const entries = [
      entry({ entryType: "charge", amount: 1, createdAt: start }),
      entry({ entryType: "charge", amount: 10, createdAt: end }),
    ];
    expect(computeStatement(entries, s, e)).toMatchObject({ openingBalance: 0, charges: 1, closingBalance: 1 });
  });
});

describe("buildStatements y hasActivity", () => {
  const { start, end } = periodBounds("2026-03-01", "2026-03-31");
  const e = (walletType: "courier" | "business", walletId: number, amount: number, createdAt: string) =>
    ({ walletType, walletId, ...entry({ entryType: "charge", amount, createdAt: d(createdAt) }) });

  it("agrupa por cuenta y ordena por tipo e id", () => {
    const rows = buildStatements([e("courier", 9, 1, "2026-03-02T12:00:00Z"), e("business", 2, 4, "2026-03-03T12:00:00Z"), e("courier", 3, 2, "2026-03-04T12:00:00Z"), e("courier", 3, 1, "2026-03-05T12:00:00Z")], start.getTime(), end.getTime());
    expect(rows.map((r) => `${r.walletType}:${r.walletId}:${r.charges}`)).toEqual(["business:2:4", "courier:3:3", "courier:9:1"]);
  });
  it("una cuenta sin nada que mostrar no tiene actividad", () => {
    const quiet = buildStatements([e("courier", 1, 5, "2026-05-01T12:00:00Z")], start.getTime(), end.getTime())[0];
    expect(hasActivity(quiet)).toBe(false); // todo ocurrió después del período
    const busy = buildStatements([e("courier", 1, 5, "2026-03-10T12:00:00Z")], start.getTime(), end.getTime())[0];
    expect(hasActivity(busy)).toBe(true);
  });
});
