/**
 * Reglas del estado de cuenta (billetera) de repartidores y comercios. Sin dependencias: las usan el servidor
 * (para aplicar el límite de deuda) y la app (para mostrar el saldo).
 *
 * Saldo = lo que la persona le debe a Rescate: cargos confirmados − pagos confirmados (+ ajustes confirmados, que
 * pueden ser negativos). Los pagos "pendientes" aún no cuentan: el admin debe confirmarlos.
 */
import { BUSINESS_RULES } from "./constants";

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

// ---------------------------------------------------------------------------------------------
// Pagos reportados por la persona, estados de cuenta por período y liquidaciones
// ---------------------------------------------------------------------------------------------

/** Pagos "por verificar" que una cuenta puede tener a la vez (evita spam al admin). */
export const MAX_PENDING_PAYMENTS = 5;
export const MIN_PAYMENT_REFERENCE_LENGTH = 4;
export const MAX_PAYMENT_AMOUNT = 10000;
/** Un reporte o liquidación abarca como máximo un año. */
export const MAX_PERIOD_DAYS = 366;

/** Quita espacios sobrantes de una referencia de pago (la comparación de duplicados no distingue mayúsculas). */
export function normalizePaymentReference(reference: string): string {
  return reference.trim().replace(/\s+/g, " ");
}

export type WalletType = "courier" | "business";
export type WalletRef = { walletType: WalletType; walletId: number };
export type DatedWalletEntry = WalletEntryLike & { createdAt: Date | string; reviewedAt?: Date | string | null };

export type Statement = {
  openingBalance: number;
  charges: number;
  payments: number;
  adjustments: number;
  closingBalance: number;
  /** Pagos que siguen por verificar (informativo: no afectan el saldo). */
  pendingPayments: number;
};

const toMs = (d: Date | string) => new Date(d).getTime();

/**
 * Momento en que un movimiento confirmado afecta el saldo. Un pago cuenta cuando el admin lo CONFIRMA
 * (no cuando la persona lo reportó): así, el estado de cuenta de un período ya cerrado no cambia después.
 */
export function effectiveTime(entry: DatedWalletEntry): number {
  return entry.entryType === "payment" && entry.reviewedAt ? toMs(entry.reviewedAt) : toMs(entry.createdAt);
}

/**
 * Estado de cuenta de UNA cuenta para el período [startMs, endMs): saldo inicial, cargos, pagos y ajustes
 * confirmados dentro del período, y saldo final. Solo cuentan movimientos confirmados.
 */
export function computeStatement(entries: DatedWalletEntry[], startMs: number, endMs: number): Statement {
  let opening = 0, charges = 0, payments = 0, adjustments = 0, pending = 0;
  for (const e of entries) {
    const amount = Number(e.amount);
    if (e.status === "pending") {
      if (e.entryType === "payment" && toMs(e.createdAt) < endMs) pending += amount;
      continue;
    }
    if (e.status !== "confirmed") continue;
    const t = effectiveTime(e);
    if (t < startMs) {
      opening += e.entryType === "payment" ? -amount : amount;
    } else if (t < endMs) {
      if (e.entryType === "charge") charges += amount;
      else if (e.entryType === "payment") payments += amount;
      else adjustments += amount;
    }
  }
  return {
    openingBalance: round2(opening),
    charges: round2(charges),
    payments: round2(payments),
    adjustments: round2(adjustments),
    closingBalance: round2(opening + charges - payments + adjustments),
    pendingPayments: round2(pending),
  };
}

/** Estado de cuenta de cada cuenta que aparece en `entries`, ordenado por tipo e id. */
export function buildStatements<T extends DatedWalletEntry & WalletRef>(entries: T[], startMs: number, endMs: number): Array<WalletRef & Statement> {
  const groups = new Map<string, T[]>();
  for (const e of entries) {
    const key = `${e.walletType}:${Number(e.walletId)}`;
    const list = groups.get(key);
    if (list) list.push(e); else groups.set(key, [e]);
  }
  const out: Array<WalletRef & Statement> = [];
  for (const [key, list] of groups) {
    const [walletType, id] = key.split(":");
    out.push({ walletType: walletType as WalletType, walletId: Number(id), ...computeStatement(list, startMs, endMs) });
  }
  return out.sort((a, b) => (a.walletType === b.walletType ? a.walletId - b.walletId : a.walletType < b.walletType ? -1 : 1));
}

/** ¿Hubo algo que mostrar en este estado de cuenta? (si no, no vale la pena listarlo ni liquidarlo) */
export function hasActivity(s: Statement): boolean {
  return [s.openingBalance, s.charges, s.payments, s.adjustments, s.closingBalance, s.pendingPayments].some((n) => n !== 0);
}

function parseDay(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/**
 * Convierte dos fechas "AAAA-MM-DD" (inclusive ambas, hora de Ecuador) en el intervalo [start, end) en UTC:
 * del 00:00 de `from` al 00:00 del día siguiente a `to`. Lanza un Error con mensaje en español si no son válidas.
 */
export function periodBounds(from: string, to: string, offsetHours: number = BUSINESS_RULES.timezoneOffsetHours) {
  const a = parseDay(from), b = parseDay(to);
  if (!a || !b) throw new Error("Las fechas deben ser válidas y tener el formato AAAA-MM-DD.");
  const startMs = Date.UTC(a.y, a.m - 1, a.d) - offsetHours * 3_600_000;
  const endMs = Date.UTC(b.y, b.m - 1, b.d + 1) - offsetHours * 3_600_000;
  if (endMs <= startMs) throw new Error("La fecha final no puede ser anterior a la inicial.");
  const days = Math.round((endMs - startMs) / 86_400_000);
  if (days > MAX_PERIOD_DAYS) throw new Error(`El período no puede superar ${MAX_PERIOD_DAYS} días.`);
  return { start: new Date(startMs), end: new Date(endMs), days };
}
