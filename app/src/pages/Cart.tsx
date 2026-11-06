import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { money } from "@/lib/format";
import { MOBILE_HINT, normalizeEcuadorMobile } from "@contracts/phone";
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
  // Los errores de los campos se muestran al intentar confirmar o al salir del campo.
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<{ address?: boolean; phone?: boolean }>({});
  const addressRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLButtonElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
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

  // Tarifa de servicio vigente: la fija el admin y el servidor cobra esta misma al confirmar.
  const fees = trpc.orders.fees.useQuery(undefined, { enabled: !!cart, retry: 1 });

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
  const serviceFee = fees.data?.serviceFee ?? null;
  const total = subtotal + deliveryFee + (serviceFee ?? 0);
  const belowMin = !!q && subtotal < q.minOrder;
  // Campos que el cliente debe completar: se explican junto al campo y no bloquean el botón en silencio.
  const isDelivery = fulfillmentMethod === "delivery";
  const fieldErrors = {
    address: isDelivery && address.trim().length < 5 ? "Escribe tu dirección (calle, número y referencia), mínimo 5 caracteres." : null,
    location: isDelivery && !deliveryCoords ? "Toca «Usar mi ubicación» para calcular el envío." : null,
    phone: !phone.trim() ? "Escribe tu celular para que podamos coordinar la entrega." : normalizeEcuadorMobile(phone) === null ? MOBILE_HINT : null,
  };
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);
  const showError = (key: "address" | "location" | "phone") => ((submitted || (key !== "location" && touched[key])) ? fieldErrors[key] : null);

  // Lo que impide confirmar y no depende de lo que escriba el cliente (tarifas, ruta, horario, mínimo).
  const blockReason = serviceFee === null
    ? (fees.error ? "No pudimos cargar las tarifas. Recarga la página." : "Calculando tarifas…")
    : !isDelivery || !deliveryCoords ? null
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
              : null;

  const field = "w-full rounded-xl border bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring";
  const fieldClass = (invalid: boolean) => `${field} ${invalid ? "border-destructive" : "border-input"}`;
  const errorText = (id: string, message: string | null) => message ? <p id={id} role="alert" className="mt-1 text-xs font-bold text-destructive">{message}</p> : null;

  function confirm() {
    setSubmitted(true);
    if (hasFieldErrors) {
      toast.error("Revisa los campos marcados en rojo.");
      const first = fieldErrors.address ? addressRef.current : fieldErrors.location ? locationRef.current : phoneRef.current;
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.focus({ preventScroll: true });
      return;
    }
    createOrder.mutate({
      businessId: cart!.businessId,
      items: cart!.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      fulfillmentMethod,
      ...(isDelivery ? { deliveryAddress: address.trim(), deliveryLat: deliveryCoords!.lat, deliveryLng: deliveryCoords!.lng } : {}),
      notes: notes.trim() || undefined,
      customerPhone: normalizeEcuadorMobile(phone) ?? undefined,
    });
  }

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
        <div>
          <label htmlFor="cart-address" className="mb-1 block text-xs font-extrabold text-muted-foreground">Dirección de entrega <span className="text-destructive">*</span></label>
          <input
            id="cart-address"
            ref={addressRef}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, address: true }))}
            placeholder="Dirección en Milagro (calle, número, referencia)"
            maxLength={300}
            aria-invalid={showError("address") ? true : undefined}
            aria-describedby={showError("address") ? "cart-address-error" : undefined}
            className={fieldClass(!!showError("address"))}
          />
          {errorText("cart-address-error", showError("address"))}
        </div>
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
          ref={locationRef}
          type="button"
          aria-invalid={showError("location") ? true : undefined}
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
          className={`w-full rounded-xl border bg-brand-soft px-4 py-3 text-sm font-extrabold text-brand-dark disabled:opacity-50 ${showError("location") ? "border-destructive" : "border-brand/30"}`}
        >
          {locating ? "Obteniendo ubicación…" : deliveryCoords ? "✓ Ubicación de entrega guardada" : "📍 Usar mi ubicación (necesaria para calcular el envío)"}
        </button>
        {errorText("cart-location-error", showError("location"))}
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
        <div>
          <label htmlFor="cart-phone" className="mb-1 block text-xs font-extrabold text-muted-foreground">Tu celular <span className="text-destructive">*</span></label>
          <input
            id="cart-phone"
            ref={phoneRef}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
            placeholder="Ej. 0991234567 (para coordinar la entrega)"
            maxLength={20}
            aria-invalid={showError("phone") ? true : undefined}
            aria-describedby={showError("phone") ? "cart-phone-error" : undefined}
            className={fieldClass(!!showError("phone"))}
          />
          {errorText("cart-phone-error", showError("phone"))}
        </div>
        <div>
          <label htmlFor="cart-notes" className="mb-1 block text-xs font-extrabold text-muted-foreground">Nota para el local (opcional)</label>
          <input
            id="cart-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Sin cebolla, extra ají…"
            maxLength={300}
            className={fieldClass(false)}
          />
        </div>
      </section>

      {/* Resumen */}
      <section className="space-y-3 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        {isDelivery && (
          <div className="flex items-center justify-between rounded-xl bg-secondary/50 px-3 py-2 text-sm font-semibold">
            <span className="text-muted-foreground">🕒 Tiempo estimado de viaje</span>
            <span className="font-extrabold">{q ? `≈ ${q.estimatedMinutes} min` : "—"}</span>
          </div>
        )}
        {isDelivery && !q && <p className="-mt-1 text-[11px] text-muted-foreground">Comparte tu ubicación para ver el tiempo y el costo del envío.</p>}
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
        {fulfillmentMethod === "delivery" && q && (
          <div className="rounded-xl bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            <p className="mb-1 font-extrabold text-foreground/70">Cómo se calcula el envío</p>
            <div className="flex justify-between"><span>Tarifa base</span><span>{money(q.baseFee)}</span></div>
            <div className="flex justify-between"><span>Distancia ({q.distanceKm} km)</span><span>{money(q.distanceFee)}</span></div>
            {q.timeFee > 0 && <div className="flex justify-between"><span>Tiempo de viaje ({q.estimatedMinutes} min)</span><span>{money(q.timeFee)}</span></div>}
            <p className="mt-1">El tiempo es referencial y puede variar según el tráfico y las condiciones de la vía.</p>
          </div>
        )}
        <div className="flex justify-between text-sm font-semibold text-muted-foreground"><span>Tarifa de servicio de Rescate</span><span>{serviceFee === null ? "—" : money(serviceFee)}</span></div>
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
          <span className="font-display text-2xl font-extrabold">{serviceFee === null ? "—" : money(total)}</span>
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
          confirm();
        }}
        className="safe-bottom sticky bottom-20 w-full rounded-2xl bg-brand py-4 font-display text-lg font-extrabold text-white shadow-lg shadow-brand/20 transition-transform hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 md:bottom-6"
      >
        {createOrder.isPending
          ? "Enviando…"
          : isAuthenticated
            ? `Confirmar pedido · ${serviceFee === null ? "—" : money(total)}`
            : "Entra para confirmar tu pedido"}
      </button>
      {isAuthenticated && blockReason && (
        <p className="text-center text-xs font-bold text-muted-foreground">{blockReason}</p>
      )}
    </div>
  );
}
