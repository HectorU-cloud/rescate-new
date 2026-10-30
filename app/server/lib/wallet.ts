import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { financeSettings, walletEntries } from "@db/schema";
import { computeBalance, computePendingPayments, debtState, type DebtState } from "@contracts/wallet";
import { getDb } from "../queries/connection";

export type WalletType = "courier" | "business";

/** Límites vigentes (solo lectura: si el admin aún no guardó configuración, se usan los valores por defecto). */
export async function getDebtLimits() {
  const [row] = await getDb().select({ courier: financeSettings.courierDebtLimit, business: financeSettings.businessDebtLimit }).from(financeSettings).where(eq(financeSettings.id, 1)).limit(1);
  return { courier: row?.courier ?? 5, business: row?.business ?? 15 };
}

export type WalletSummary = { balance: number; pendingPayments: number; limit: number; state: DebtState };

export async function walletSummary(walletType: WalletType, walletId: number): Promise<WalletSummary> {
  const rows = await getDb()
    .select({ entryType: walletEntries.entryType, amount: walletEntries.amount, status: walletEntries.status })
    .from(walletEntries)
    .where(and(eq(walletEntries.walletType, walletType), eq(walletEntries.walletId, walletId)));
  const limit = (await getDebtLimits())[walletType];
  const balance = computeBalance(rows);
  return { balance, pendingPayments: computePendingPayments(rows), limit, state: debtState(balance, limit) };
}

/** Impide tomar o aceptar pedidos nuevos mientras la deuda supere el límite que configuró el admin. */
export async function assertWalletNotBlocked(walletType: WalletType, walletId: number): Promise<void> {
  const w = await walletSummary(walletType, walletId);
  if (w.state !== "blocked") return;
  const money = (n: number) => `$${n.toFixed(2)}`;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Tu saldo pendiente con Rescate (${money(w.balance)}) supera el límite de ${money(w.limit)}. ${
      walletType === "courier" ? "Paga tu saldo para volver a tomar pedidos." : "Paga tu saldo para volver a aceptar pedidos."
    }${w.pendingPayments > 0 ? ` Tienes ${money(w.pendingPayments)} en pagos por verificar.` : ""}`,
  });
}
