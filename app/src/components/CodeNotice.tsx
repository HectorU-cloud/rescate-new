import { BUSINESS_RULES } from "@contracts/constants";

// Aviso cuando alguien intentó confirmar la entrega/retiro con un código incorrecto
export function CodeNotice({ attempts, pending, onRegenerate }: { attempts: number; pending: boolean; onRegenerate: () => void }) {
  if (attempts <= 0) return null;
  const locked = attempts >= BUSINESS_RULES.maxCodeAttempts;
  return (
    <div className={`mt-3 rounded-2xl px-3 py-2 text-left text-xs font-bold ${locked ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-900"}`}>
      <p>
        {locked
          ? "🔒 Se agotaron los intentos de confirmación."
          : `⚠️ Se intentó confirmar con un código incorrecto (${attempts} de ${BUSINESS_RULES.maxCodeAttempts}).`}
      </p>
      <p className="mt-0.5 font-semibold">
        {locked
          ? "Genera un código nuevo para poder continuar. Compártelo solo con quien te entrega el pedido."
          : "Si no fue el repartidor o el local quien lo intentó, genera un código nuevo."}
      </p>
      <button
        disabled={pending}
        onClick={onRegenerate}
        className="mt-2 w-full rounded-xl bg-foreground py-2 text-xs font-extrabold text-white disabled:opacity-50"
      >
        {pending ? "Generando…" : "Generar código nuevo"}
      </button>
    </div>
  );
}
