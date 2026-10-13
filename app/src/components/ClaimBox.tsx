import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";

type Role = "customer" | "business" | "courier";

const PLACEHOLDER: Record<Role, string> = {
  customer: "Cuéntanos qué pasó (pedido incompleto, demora, trato, cobro…)",
  business: "Cuéntanos qué pasó (cliente no retiró, datos falsos, trato, cobro…)",
  courier: "Cuéntanos qué pasó (dirección incorrecta, cliente no responde, local demoró…)",
};

/**
 * Reclamo sobre un pedido, para cliente, comercio o repartidor.
 * Con `collapsible` aparece como un botón pequeño que se despliega (para tarjetas de listas).
 */
export function ClaimBox({ orderId, role, collapsible = false }: { orderId: number; role: Role; collapsible?: boolean }) {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const [expanded, setExpanded] = useState(!collapsible);
  const claims = trpc.orders.myClaims.useQuery({ orderId });
  const mine = (claims.data ?? []).filter((c) => c.reporterRole === role);
  const create = trpc.orders.createClaim.useMutation({
    onSuccess: () => {
      setReason("");
      toast.success("Reclamo enviado. Te responderemos pronto.");
      utils.orders.myClaims.invalidate({ orderId });
    },
    onError: (e) => toast.error(e.message),
  });
  const hasOpen = mine.some((c) => c.status === "open");

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mt-3 w-full rounded-xl bg-secondary py-2 text-xs font-extrabold text-muted-foreground"
      >
        🚩 {mine.length > 0 ? `Mis reclamos (${mine.length})` : "Reportar un problema"}
      </button>
    );
  }

  return (
    <section className={`space-y-3 rounded-3xl bg-card p-4 ${collapsible ? "mt-3 ring-1 ring-border" : "shadow-sm ring-1 ring-border"}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">¿Hubo un problema?</p>
        {collapsible && (
          <button onClick={() => setExpanded(false)} className="text-xs font-bold text-muted-foreground underline">
            Cerrar
          </button>
        )}
      </div>
      {mine.map((c) => (
        <div key={c.id} className="rounded-xl bg-secondary px-3 py-2 text-xs font-semibold">
          <p>
            <b>{c.status === "open" ? "🕒 En revisión" : c.status === "resolved" ? "✅ Resuelto" : "❌ Rechazado"}:</b> {c.reason}
          </p>
          {c.resolution && <p className="mt-1 text-muted-foreground">Respuesta: {c.resolution}</p>}
        </div>
      ))}
      {!hasOpen && (
        <>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={PLACEHOLDER[role]}
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            disabled={create.isPending || reason.trim().length < 10}
            onClick={() => create.mutate({ orderId, reason: reason.trim(), role })}
            className="w-full rounded-xl bg-foreground py-3 text-sm font-extrabold text-white disabled:opacity-50"
          >
            {create.isPending ? "Enviando…" : "Enviar reclamo"}
          </button>
        </>
      )}
    </section>
  );
}
