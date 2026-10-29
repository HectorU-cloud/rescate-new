import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { money } from "@/lib/format";
import { toast } from "sonner";

export default function Cart() {
  const { cart, subtotal, setQty, remove, clear } = useCart();
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"delivery" | "pickup">("delivery");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [addressLabel, setAddressLabel] = useState("Casa");
  const utils = trpc.useUtils();
  const savedAddresses = trpc.profile.myAddresses.useQuery(undefined, { enabled: isAuthenticated });
  const saveAddress = trpc.profile.saveAddress.useMutation({
    onSuccess: async () => { await utils.profile.myAddresses.invalidate(); toast.success("Dirección guardada para próximas compras"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteAddress = trpc.profile.deleteAddress.useMutation({
    onSuccess: async () => { await utils.profile.myAddresses.invalidate(); toast.success("Dirección eliminada"); },
    onError: (e) => toast.error(e.message),
  });

  // El servidor calcula distancia, radio y tarifa; aquí solo se muestra la cotización.
  const quote = trpc.orders.quote.useQuery(
    { businessId: cart?.businessId ?? 0, lat: deliveryCoords?.lat ?? 0, lng: deliveryCoords?.lng ?? 0 },
    { enabled: isAuthenticated && !!cart && fulfillmentMethod === "delivery" && !!deliveryCoords, retry: false },
  );

  const createOrder = trpc.orders.createDelivery.useMutation({
    onSuccess: (data) => {
      clear();
      toast.success("¡Pedido enviado al local!");
      if (data) navigate(`/pedido/${data.order.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!cart || cart.items.length === 0) {
    return (
      <div className="rounded-3xl bg-card p-10 text-center ring-1 ring-border">
        <p className="text-5xl">🛒</p>
        <h1 className="font-display mt-3 text-xl font-extrabold">
          Tu carrito está vacío
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Explora los locales de Milagro y antójate de algo
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-white"
        >
          Ver locales
        </button>
      </div>
    );
  }

  const q = quote.data;
  const deliveryFee = fulfillmentMethod === "pickup" ? 0 : (q?.fee ?? cart.deliveryFee);
  const serviceFee = 0.42; // Tarifa de servicio de lanzamiento, visible al cliente.
  const total = subtotal + deliveryFee + serviceFee;
  const belowMin = !!q && subtotal < q.minOrder;
  const blockReason = fulfillmentMethod === "pickup" ? null : !deliveryCoords
    ? "Comparte tu ubicación para calcular el envío"
    : quote.isLoading
      ? "Calculando envío…"
      : quote.error
        ? quote.error.message
        : q && !q.withinRadius
          ? `Estás a ${q.distanceKm} km y este local entrega hasta ${q.radiusKm} km`
          : q && !q.openNow
            ? `El local está cerrado (atiende de ${q.opensAt} a ${q.closesAt})`
            : belowMin
              ? `El pedido mínimo es ${money(q!.minOrder)}`
              : fulfillmentMethod === "delivery" && address.trim().length < 5
                ? "Escribe tu dirección para continuar"
                : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="space-y-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand">Al Rescate · Tu compra</p>
          <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight">Revisa tu pedido</h1>
          <p className="mt-1 text-sm text-muted-foreground">Confirma los productos y los datos de entrega antes de enviarlo al local.</p>
        </div>
        <ol aria-label="Pasos de compra" className="grid grid-cols-3 gap-2">
          <li className="rounded-2xl border border-brand/30 bg-brand-soft px-3 py-3 text-center">
            <span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-extrabold text-white">1</span>
            <span className="mt-1 block text-xs font-extrabold text-brand-dark">Tu carrito</span>
          </li>
          <li className="rounded-2xl border border-border bg-card px-3 py-3 text-center">
            <span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-secondary text-xs font-extrabold">2</span>
            <span className="mt-1 block text-xs font-bold text-muted-foreground">Entrega</span>
          </li>
          <li className="rounded-2xl border border-border bg-card px-3 py-3 text-center">
            <span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-secondary text-xs font-extrabold">3</span>
            <span className="mt-1 block text-xs font-bold text-muted-foreground">Confirmación</span>
          </li>
        </ol>
      </header>

      <section className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border sm:p-5">
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-secondary/70 p-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-card text-xl shadow-sm">🏪</span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">Pedido de</p>
            <p className="truncate text-sm font-extrabold">{cart.businessName}</p>
          </div>
          <span className="rounded-full bg-card px-3 py-1 text-[10px] font-extrabold text-brand">Rescate</span>
        </div>
        <ul className="space-y-3">
          {cart.items.map((i) => (
            <li key={i.productId} className="flex items-center gap-3 rounded-2xl border border-border/70 p-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-secondary text-2xl">
                {i.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">{i.name}</p>
                <p className="text-xs font-bold text-muted-foreground">
                  {money(i.price)} c/u
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-full bg-secondary p-1">
                <button
                  aria-label={`Disminuir cantidad de ${i.name}`}
                  onClick={() => setQty(i.productId, i.quantity - 1)}
                  className="grid h-8 w-8 place-items-center rounded-full bg-card font-extrabold shadow-sm"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-extrabold">
                  {i.quantity}
                </span>
                <button
                  aria-label={`Aumentar cantidad de ${i.name}`}
                  onClick={() => setQty(i.productId, i.quantity + 1)}
                  className="grid h-8 w-8 place-items-center rounded-full bg-card font-extrabold shadow-sm"
                >
                  +
                </button>
              </div>
              <div className="w-20 text-right">
                <span className="block font-display text-sm font-extrabold">{money(i.price * i.quantity)}</span>
                <button type="button" onClick={() => remove(i.productId)} className="mt-1 text-[10px] font-bold text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-destructive">Quitar</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Entrega */}
      <section className="space-y-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          ¿Cómo quieres recibirlo?
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary p-1">
          <button type="button" onClick={() => setFulfillmentMethod("delivery")} className={`rounded-xl px-3 py-3 text-sm font-extrabold ${fulfillmentMethod === "delivery" ? "bg-card text-brand shadow-sm" : "text-muted-foreground"}`}>🛵 A domicilio</button>
          <button type="button" onClick={() => { setFulfillmentMethod("pickup"); setDeliveryCoords(null); }} className={`rounded-xl px-3 py-3 text-sm font-extrabold ${fulfillmentMethod === "pickup" ? "bg-card text-brand shadow-sm" : "text-muted-foreground"}`}>🏪 Retirar en local</button>
        </div>
        {fulfillmentMethod === "delivery" ? <>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Dirección en Milagro (calle, número, referencia)"
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />
        {isAuthenticated && (savedAddresses.data?.length ?? 0) > 0 && (
          <div className="space-y-2 rounded-2xl bg-secondary/60 p-3">
            <p className="text-xs font-extrabold">Mis direcciones guardadas</p>
            {savedAddresses.data!.map((saved) => (
              <div key={saved.id} className="flex items-center gap-2 rounded-xl bg-card p-3">
                <button type="button" onClick={() => { setAddress(saved.address); setDeliveryCoords({ lat: saved.lat, lng: saved.lng }); }} className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-extrabold">{saved.label}{saved.isDefault ? " · Principal" : ""}</span>
                  <span className="block truncate text-xs text-muted-foreground">{saved.address}</span>
                </button>
                <button type="button" aria-label={`Eliminar ${saved.label}`} onClick={() => deleteAddress.mutate({ id: saved.id })} className="rounded-lg px-2 py-1 text-xs font-bold text-destructive">Eliminar</button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={locating || !navigator.geolocation}
          onClick={() => {
            if (!navigator.geolocation) {
              toast.error("Este navegador no permite obtener tu ubicación");
              return;
            }
            setLocating(true);
            navigator.geolocation.getCurrentPosition(
              (position) => {
                setDeliveryCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
                setLocating(false);
                toast.success("Ubicación guardada");
              },
              (error) => {
                setLocating(false);
                toast.error(error.code === error.PERMISSION_DENIED ? "Permite el acceso a tu ubicación para usar esta opción" : "No pudimos obtener tu ubicación. Intenta de nuevo");
              },
              { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
            );
          }}
          className="w-full rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm font-extrabold text-brand-dark disabled:opacity-50"
        >
          {locating ? "Obteniendo ubicación…" : deliveryCoords ? "✓ Ubicación de entrega guardada" : "📍 Usar mi ubicación (necesaria para calcular el envío)"}
        </button>
        <p className="text-[11px] text-muted-foreground">
          La ubicación se usa para calcular la distancia, el costo de envío y la llegada estimada. Verifica que coincida con la dirección escrita.
        </p>
        {isAuthenticated && address.trim().length >= 5 && deliveryCoords && (
          <div className="flex gap-2">
            <input value={addressLabel} onChange={(e) => setAddressLabel(e.target.value)} maxLength={60} placeholder="Nombre: Casa, Trabajo…" className="min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            <button type="button" disabled={saveAddress.isPending || !addressLabel.trim()} onClick={() => saveAddress.mutate({ label: addressLabel.trim(), address: address.trim(), lat: deliveryCoords.lat, lng: deliveryCoords.lng, isDefault: (savedAddresses.data?.length ?? 0) === 0 })} className="rounded-xl bg-brand px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50">
              {saveAddress.isPending ? "Guardando…" : "Guardar dirección"}
            </button>
          </div>
        )}
        </> : <div className="rounded-2xl bg-brand-soft p-4 text-sm font-semibold text-brand-dark">🏪 Recogerás tu pedido directamente en <strong>{cart.businessName}</strong>. No se asignará repartidor ni se cobrará envío. Revisa el horario del local antes de confirmar.</div>}
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Tu celular (para coordinar la entrega)"
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Nota para el local (opcional): sin cebolla, extra ají…"
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />
      </section>

      {/* Resumen */}
      <section className="space-y-3 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <div className="flex justify-between text-sm font-semibold text-muted-foreground">
          <span>Subtotal</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold text-muted-foreground">
          <span>
            {fulfillmentMethod === "pickup" ? "Envío" : `Envío (va para el repartidor)${q ? ` · ${q.distanceKm} km` : ""}`}
          </span>
          <span>{fulfillmentMethod === "pickup" ? money(0) : q ? money(deliveryFee) : "—"}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold text-muted-foreground"><span>Tarifa de servicio de Rescate</span><span>{money(serviceFee)}</span></div>
        {fulfillmentMethod === "delivery" && q && q.minOrder > 0 && (
          <p className={`text-xs font-bold ${belowMin ? "text-destructive" : "text-muted-foreground"}`}>
            Pedido mínimo: {money(q.minOrder)}
          </p>
        )}
        <div className="flex items-end justify-between rounded-2xl bg-brand-soft p-4 text-brand-dark">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide">Total a pagar</p>
            <p className="mt-1 text-[11px] font-semibold opacity-80">Efectivo {fulfillmentMethod === "pickup" ? "en el local" : "al recibir"}</p>
          </div>
          <span className="font-display text-2xl font-extrabold">{money(total)}</span>
        </div>
        <p className="flex items-start gap-2 rounded-xl bg-secondary px-3 py-3 text-xs font-semibold text-muted-foreground">
          <span aria-hidden="true">💵</span><span>{fulfillmentMethod === "pickup" ? "Pagas en efectivo al retirar tu pedido en el local. No se asignará repartidor." : "Pagas en efectivo al recibir. Revisa tu dirección y teléfono para que el repartidor pueda coordinar la entrega. El pago en línea estará disponible próximamente."}</span>
        </p>
      </section>

      <button
        disabled={createOrder.isPending || (isAuthenticated && blockReason !== null)}
        onClick={() => {
          if (!isAuthenticated) {
            navigate("/login");
            return;
          }
          createOrder.mutate({
            businessId: cart.businessId,
            items: cart.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
            })),
            fulfillmentMethod,
            ...(fulfillmentMethod === "delivery" ? { deliveryAddress: address.trim(), deliveryLat: deliveryCoords!.lat, deliveryLng: deliveryCoords!.lng } : {}),
            notes: notes.trim() || undefined,
            customerPhone: phone.trim() || undefined,
          });
        }}
        className="safe-bottom sticky bottom-20 w-full rounded-2xl bg-brand py-4 font-display text-lg font-extrabold text-white shadow-lg shadow-brand/20 transition-transform hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 md:bottom-6"
      >
        {createOrder.isPending
          ? "Enviando…"
          : isAuthenticated
            ? `Confirmar pedido · ${money(total)}`
            : "Entra para confirmar tu pedido"}
      </button>
      {isAuthenticated && blockReason && (
        <p className="text-center text-xs font-bold text-muted-foreground">{blockReason}</p>
      )}
    </div>
  );
}
