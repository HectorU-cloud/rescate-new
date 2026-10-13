import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { money } from "@/lib/format";
import { toast } from "sonner";

export default function Cart() {
  const { cart, subtotal, setQty, clear } = useCart();
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

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

  const total = subtotal + cart.deliveryFee;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="font-display text-2xl font-extrabold">Tu pedido</h1>

      <section className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
        <p className="mb-3 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          {cart.businessName}
        </p>
        <ul className="space-y-3">
          {cart.items.map((i) => (
            <li key={i.productId} className="flex items-center gap-3">
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
                  onClick={() => setQty(i.productId, i.quantity - 1)}
                  className="grid h-8 w-8 place-items-center rounded-full bg-card font-extrabold shadow-sm"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-extrabold">
                  {i.quantity}
                </span>
                <button
                  onClick={() => setQty(i.productId, i.quantity + 1)}
                  className="grid h-8 w-8 place-items-center rounded-full bg-card font-extrabold shadow-sm"
                >
                  +
                </button>
              </div>
              <span className="w-16 text-right font-display text-sm font-extrabold">
                {money(i.price * i.quantity)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Entrega */}
      <section className="space-y-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          ¿A dónde lo llevamos?
        </p>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Dirección en Milagro (calle, número, referencia)"
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />
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
                toast.success("Ubicación guardada para estimar la llegada");
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
          {locating ? "Obteniendo ubicación…" : deliveryCoords ? "✓ Ubicación de entrega guardada" : "📍 Usar mi ubicación para estimar la llegada (opcional)"}
        </button>
        <p className="text-[11px] text-muted-foreground">
          La ubicación es opcional y se usa para calcular una ETA aproximada. Verifica que coincida con la dirección escrita.
        </p>
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
      <section className="space-y-2 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
        <div className="flex justify-between text-sm font-semibold text-muted-foreground">
          <span>Subtotal</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold text-muted-foreground">
          <span>Envío (va para el repartidor)</span>
          <span>{money(cart.deliveryFee)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-2 font-display text-lg font-extrabold">
          <span>Total</span>
          <span>{money(total)}</span>
        </div>
        <p className="rounded-xl bg-secondary px-3 py-2 text-xs font-bold text-muted-foreground">
          💵 Pagas en efectivo al recibir. Pago en línea: próximamente.
        </p>
      </section>

      <button
        disabled={createOrder.isPending || address.trim().length < 5}
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
            deliveryAddress: address.trim(),
            deliveryLat: deliveryCoords?.lat,
            deliveryLng: deliveryCoords?.lng,
            notes: notes.trim() || undefined,
            customerPhone: phone.trim() || undefined,
          });
        }}
        className="safe-bottom sticky bottom-20 w-full rounded-2xl bg-brand py-4 font-display text-lg font-extrabold text-white shadow-lg transition-transform active:scale-[0.98] disabled:opacity-50 md:bottom-6"
      >
        {createOrder.isPending
          ? "Enviando…"
          : isAuthenticated
            ? `Confirmar pedido · ${money(total)}`
            : "Entra para confirmar tu pedido"}
      </button>
      {address.trim().length < 5 && (
        <p className="text-center text-xs font-bold text-muted-foreground">
          Escribe tu dirección para continuar
        </p>
      )}
    </div>
  );
}
