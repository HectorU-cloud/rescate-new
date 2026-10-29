import {
  DELIVERY_FLOW,
  ORDER_STATUS_LABELS,
  RESCUE_FLOW,
  type OrderStatusKey,
} from "@contracts/constants";

export function StatusTimeline({
  type,
  status,
  fulfillmentMethod = "delivery",
}: {
  type: "delivery" | "rescue";
  status: string;
  fulfillmentMethod?: "delivery" | "pickup";
}) {
  const isLocalPickup = type === "delivery" && fulfillmentMethod === "pickup";
  const flow = type === "delivery"
    ? isLocalPickup
      ? ["pending", "accepted", "preparing", "ready", "delivered"] as OrderStatusKey[]
      : DELIVERY_FLOW
    : RESCUE_FLOW;
  const current = flow.indexOf(status as OrderStatusKey);

  if (status === "cancelled") {
    return (
      <div className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
        Este pedido fue cancelado
      </div>
    );
  }

  return (
    <ol className="space-y-0">
      {flow.map((s, i) => {
        const meta = ORDER_STATUS_LABELS[s];
        const label = isLocalPickup && s === "ready" ? "Listo para retirar" : isLocalPickup && s === "delivered" ? "Retirado" : meta.label;
        const description = isLocalPickup && s === "ready" ? "Puedes recoger tu pedido en el local" : isLocalPickup && s === "delivered" ? "Has retirado tu pedido del local" : type === "delivery" ? meta.delivery : meta.rescue;
        const done = i <= current;
        const isCurrent = i === current;
        return (
          <li key={s} className="relative flex gap-3 pb-6 last:pb-0">
            {i < flow.length - 1 && (
              <span
                className={`absolute left-[13px] top-7 h-full w-0.5 ${
                  i < current ? "bg-brand" : "bg-border"
                }`}
              />
            )}
            <span
              className={`z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${
                done
                  ? "bg-brand text-white"
                  : "bg-secondary text-muted-foreground"
              } ${isCurrent ? "animate-pulse-dot" : ""}`}
            >
              {done ? "✓" : i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p
                className={`text-sm font-extrabold ${
                  done ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </p>
              {isCurrent && (
                <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
