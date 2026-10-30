/**
 * Reglas del estado de cuenta (billetera) de repartidores y comercios. Sin dependencias: las usan el servidor
 * (para aplicar el límite de deuda) y la app (para mostrar el saldo).
 *
 * Saldo = lo que la persona le debe a Rescate: cargos confirmados − pagos confirmados (+ ajustes confirmados, que
 * pueden ser negativos). Los pagos "pendientes" aún no cuentan: el admin debe confirmarlos.
 */
export type WalletEntryLike = {
  entryType: "charge" | "payment" | "adjustment";
  amount: number;
  status: "pending" | "confirmed" | "rejected";
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeBalance(entries: WalletEntryLike[]): number {
  let total = 0;
  for (const e of entries) {
    if (e.status !== "confirmed") continue;
    total += e.entryType === "payment" ? -Number(e.amount) : Number(e.amount);
  }
  return round2(total);
}

export function computePendingPayments(entries: WalletEntryLike[]): number {
  return round2(entries.filter((e) => e.entryType === "payment" && e.status === "pending").reduce((sum, e) => sum + Number(e.amount), 0));
}

/** A partir de este porcentaje del límite se avisa que está cerca. */
export const DEBT_WARNING_RATIO = 0.8;

export type DebtState = "ok" | "warning" | "blocked";

/**
 * `limit <= 0` significa "sin límite" (así el admin puede desactivar el bloqueo).
 * Se bloquea cuando la deuda SUPERA el límite.
 */
export function debtState(balance: number, limit: number): DebtState {
  if (!(limit > 0) || balance <= 0) return "ok";
  if (balance > limit) return "blocked";
  if (balance >= limit * DEBT_WARNING_RATIO) return "warning";
  return "ok";
}

export const PREP_MINUTES_OPTIONS = [10, 15, 20, 30, 45] as const;
export const DEFAULT_PREP_MINUTES = 15;
export const MIN_PREP_MINUTES = 5;
export const MAX_PREP_MINUTES = 120;
