import { useDialogs } from "@/providers/dialogs";
import WalletCard from "@/components/WalletCard";
import { DEFAULT_PREP_MINUTES, PREP_MINUTES_OPTIONS } from "@contracts/wallet";
import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useNewOrderAlert } from "@/hooks/useNewOrderAlert";
import { playNewOrderBeep, unlockAudio } from "@/lib/alert-sound";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { money, timeAgo, withinMinutes } from "@/lib/format";
import { ClaimBox } from "@/components/ClaimBox";
import { LocationPicker, type Point } from "@/components/LocationPicker";
import { isInServiceArea } from "@contracts/geo";
import { computePackExpiry, describePackExpiry } from "@contracts/packs";
import { compressProductImage, uploadCompressedImage } from "@/lib/product-image";
import BusinessImageField from "@/components/BusinessImageField";
import { PHONE_HINT, normalizeEcuadorPhone } from "@contracts/phone";
import { describeOptions } from "@contracts/options";
import OptionGroupsManager from "@/components/OptionGroupsManager";
import {
  BUSINESS_CATEGORIES,
  BUSINESS_RULES,
  ORDER_STATUS_LABELS,
  type OrderStatusKey,
} from "@contracts/constants";
import { toast } from "sonner";

export default function BusinessPanel() {
  const { user, isAuthenticated } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const myBusiness = trpc.business.myBusiness.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) return null;

  if (user?.appRole !== "business") {
    return (
      <div className="mx-auto max-w-lg rounded-3xl bg-card p-8 text-center ring-1 ring-border">
        <p className="text-5xl">🏪</p>
        <h1 className="font-display mt-3 text-xl font-extrabold">
          Esta zona es para comercios
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cambia tu rol a “Tengo un negocio” desde tu perfil para administrar un
          local.
        </p>
      </div>
    );
  }

  if (myBusiness.isLoading) {
    return <div className="h-64 animate-pulse rounded-3xl bg-muted" />;
  }

  if (!myBusiness.data) {
    return <BusinessSetup />;
  }

  return <Panel businessId={myBusiness.data.id} isOpen={myBusiness.data.isOpen} businessName={myBusiness.data.name} business={myBusiness.data} />;
}

// ---------------------------------------------------------------------------
// Registro del local
// ---------------------------------------------------------------------------
type SetupForm = {
  name: string; description: string; category: string; address: string; phone: string; emoji: string;
  deliveryFee: number; deliveryMinutes: number; feePerKm: number; deliveryRadiusKm: number; minOrder: number;
  opensAt: string; closesAt: string;
};
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Reglas del formulario de registro (el servidor valida lo mismo; aquí se explica al dueño qué corregir). */
function validateSetup(form: SetupForm, loc: Point | null): Partial<Record<keyof SetupForm | "location", string>> {
  const errors: Partial<Record<keyof SetupForm | "location", string>> = {};
  if (form.name.trim().length < 2) errors.name = "Escribe el nombre de tu local (mínimo 2 letras).";
  if (form.address.trim().length < 5) errors.address = "Escribe la dirección con calle, número y una referencia.";
  if (!form.phone.trim()) errors.phone = "Escribe un teléfono de contacto.";
  else if (!normalizeEcuadorPhone(form.phone)) errors.phone = PHONE_HINT;
  if (!(form.deliveryFee >= 0 && form.deliveryFee <= 20)) errors.deliveryFee = "Debe estar entre $0 y $20.";
  if (!(form.deliveryMinutes >= 5 && form.deliveryMinutes <= 120)) errors.deliveryMinutes = "Debe estar entre 5 y 120 minutos.";
  if (!(form.feePerKm >= 0 && form.feePerKm <= 5)) errors.feePerKm = "Debe estar entre $0 y $5 por km.";
  if (!(form.deliveryRadiusKm >= 0.5 && form.deliveryRadiusKm <= BUSINESS_RULES.maxDeliveryRadiusKm)) errors.deliveryRadiusKm = `Debe estar entre 0,5 y ${BUSINESS_RULES.maxDeliveryRadiusKm} km.`;
  if (!(form.minOrder >= 0 && form.minOrder <= 200)) errors.minOrder = "Debe estar entre $0 y $200.";
  if (!TIME_RE.test(form.opensAt)) errors.opensAt = "Elige la hora de apertura.";
  if (!TIME_RE.test(form.closesAt)) errors.closesAt = "Elige la hora de cierre.";
  if (!loc) errors.location = "Marca la ubicación de tu local en el mapa.";
  else if (!isInServiceArea(loc.lat, loc.lng)) errors.location = "La ubicación debe estar dentro de la zona de servicio (las ciudades donde operamos).";
  return errors;
}

function BusinessSetup() {
  const utils = trpc.useUtils();
  const [loc, setLoc] = useState<Point | null>(null);
  const [form, setForm] = useState<SetupForm>({
    name: "",
    description: "",
    category: "comida-rapida",
    address: "",
    phone: "",
    emoji: "🍽️",
    deliveryFee: 1,
    deliveryMinutes: 30,
    feePerKm: 0.25,
    deliveryRadiusKm: 5,
    minOrder: 0,
    opensAt: "08:00",
    closesAt: "22:00",
  });
  const [touched, setTouched] = useState<Partial<Record<keyof SetupForm, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  // La foto se elige ahora pero se sube después de crear el local (la subida necesita que el local exista).
  const [logoData, setLogoData] = useState<string | null>(null);
  const save = trpc.business.upsertBusiness.useMutation({ onError: (e) => toast.error(e.message) });
  const createImageUpload = trpc.business.createImageUpload.useMutation();
  const setBusinessImage = trpc.business.setBusinessImage.useMutation();

  const errors = validateSetup(form, loc);
  const show = (key: keyof SetupForm | "location") => ((key === "location" ? submitted : submitted || touched[key as keyof SetupForm]) ? errors[key] : undefined);

  async function submit() {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) {
      toast.error("Revisa los campos marcados en rojo.");
      setTimeout(() => {
        const first = document.querySelector<HTMLElement>("[aria-invalid='true'], [data-invalid='true']");
        first?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (first && "focus" in first) first.focus({ preventScroll: true });
      }, 0);
      return;
    }
    try {
      const result = await save.mutateAsync({
        ...form,
        name: form.name.trim(),
        address: form.address.trim(),
        description: form.description.trim() || undefined,
        phone: form.phone.trim(),
        emoji: form.emoji.trim() || "🍽️",
        lat: loc!.lat,
        lng: loc!.lng,
      });
      if (logoData) {
        try {
          const imageUrl = await uploadCompressedImage(logoData, "business-logo", createImageUpload.mutateAsync);
          await setBusinessImage.mutateAsync({ imageUrl });
        } catch {
          toast.warning("Tu local se envió, pero no pudimos subir la foto. Puedes agregarla después desde el panel.");
        }
      }
      toast.success(result.reviewRequired
        ? "Nombre/dirección enviados a revisión. Los datos actuales seguirán publicados hasta la aprobación."
        : "Datos del local guardados.");
      await utils.business.myBusiness.invalidate();
      void utils.catalog.invalidate();
    } catch {
      // el error del guardado ya se muestra en un aviso
    }
  }

  const inputClass = (invalid: boolean) =>
    `w-full rounded-xl border bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring ${invalid ? "border-destructive" : "border-input"}`;
  const errorText = (message?: string) => message ? <span role="alert" className="mt-1 block text-xs font-bold text-destructive">{message}</span> : null;

  const field = (
    label: string,
    key: keyof SetupForm,
    props: React.InputHTMLAttributes<HTMLInputElement> & { required?: boolean } = {},
  ) => {
    const { required, ...inputProps } = props;
    const message = show(key);
    return (
      <label className="block">
        <span className="mb-1 block text-xs font-extrabold text-muted-foreground">
          {label}{required && <span className="text-destructive"> *</span>}
        </span>
        <input
          {...inputProps}
          value={form[key] as string | number}
          aria-invalid={message ? true : undefined}
          onBlur={() => setTouched((t) => ({ ...t, [key]: true }))}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              [key]: props.type === "number" ? Number(e.target.value) : e.target.value,
            }))
          }
          className={inputClass(!!message)}
        />
        {errorText(message)}
      </label>
    );
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold">
          Registra tu local 🏪
        </h1>
        <p className="text-sm font-semibold text-muted-foreground">
          En 1 minuto empiezas a vender en Milagro. Los campos con <span className="text-destructive">*</span> son obligatorios.
        </p>
      </div>
      <div className="space-y-3 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        {field("Nombre del local", "name", { placeholder: "Panadería El Trigal", required: true, maxLength: 150 })}
        {field("Descripción corta", "description", {
          placeholder: "Qué vendes y qué te hace especial",
          maxLength: 500,
        })}
        <label className="block">
          <span className="mb-1 block text-xs font-extrabold text-muted-foreground">
            Categoría <span className="text-destructive">*</span>
          </span>
          <select
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none"
          >
            {BUSINESS_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </label>
        {field("Dirección en Milagro", "address", {
          placeholder: "Calle, número, referencia",
          required: true,
          maxLength: 255,
        })}
        {field("Teléfono de contacto", "phone", {
          type: "tel",
          inputMode: "tel",
          autoComplete: "tel",
          placeholder: "0991234567",
          required: true,
          maxLength: 20,
        })}
        <div className="grid grid-cols-2 gap-3">
          {field("Tarifa de envío ($)", "deliveryFee", {
            type: "number",
            min: 0,
            step: 0.25,
            required: true,
          })}
          {field("Tiempo de entrega (min)", "deliveryMinutes", {
            type: "number",
            min: 5,
            required: true,
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field("Costo por km ($)", "feePerKm", { type: "number", min: 0, step: 0.05, required: true })}
          {field("Radio de entrega (km)", "deliveryRadiusKm", { type: "number", min: 0.5, max: 15, step: 0.5, required: true })}
          {field("Pedido mínimo ($)", "minOrder", { type: "number", min: 0, step: 0.5 })}
          <span />
          {field("Abre a las", "opensAt", { type: "time", required: true })}
          {field("Cierra a las", "closesAt", { type: "time", required: true })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Envío = tarifa base + costo por km según la distancia al cliente. Horario en hora de Ecuador.
        </p>
        {field("Emoji de tu local", "emoji", { placeholder: "🍕", maxLength: 4 })}
        <BusinessImageField
          previewUrl={logoData}
          emoji={form.emoji}
          busy={save.isPending}
          onSelect={(dataUrl) => setLogoData(dataUrl)}
          onRemove={() => setLogoData(null)}
        />
        <div className="space-y-2" data-invalid={show("location") ? "true" : undefined} tabIndex={-1}>
          <p className="text-xs font-extrabold text-muted-foreground">📍 Ubicación exacta de tu local <span className="text-destructive">*</span></p>
          <p className="text-[11px] text-muted-foreground">
            De este punto salen el costo de envío por km, el radio de entrega y la ruta del repartidor. Es obligatoria.
          </p>
          <LocationPicker value={loc} onChange={setLoc} />
          {errorText(show("location"))}
        </div>
        <button
          disabled={save.isPending || setBusinessImage.isPending}
          onClick={() => void submit()}
          className="w-full rounded-2xl bg-brand py-3.5 font-display text-base font-extrabold text-white disabled:opacity-50"
        >
          {save.isPending || setBusinessImage.isPending ? "Guardando…" : "Enviar mi local a revisión"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel con pestañas
// ---------------------------------------------------------------------------
type Tab = "pedidos" | "menu" | "rescate" | "resenas";

function Panel({
  businessId,
  isOpen,
  businessName,
  business,
}: {
  businessId: number;
  isOpen: boolean;
  businessName: string;
  business: {
    approvalStatus: "pending" | "approved" | "rejected";
    approvalNote: string | null;
    imageUrl: string | null;
    emoji: string;
    locationConfirmed: boolean;
    lat: number;
    lng: number;
    deliveryFee: number;
    feePerKm: number;
    deliveryRadiusKm: number;
    minOrder: number;
    opensAt: string;
    closesAt: string;
  };
}) {
  const [tab, setTab] = useState<Tab>("pedidos");
  const utils = trpc.useUtils();
  const stats = trpc.business.stats.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const toggleOpen = trpc.business.toggleOpen.useMutation({
    onSuccess: () => {
      utils.business.myBusiness.invalidate();
      utils.catalog.invalidate();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">{businessName}</h1>
          <p className="text-xs font-bold text-muted-foreground">
            Panel del comercio
          </p>
        </div>
        <button
          onClick={() => toggleOpen.mutate({ isOpen: !isOpen })}
          className={`rounded-full px-4 py-2 text-sm font-extrabold text-white ${
            isOpen ? "bg-brand" : "bg-foreground"
          }`}
        >
          {isOpen ? "🟢 Abierto" : "⚫ Cerrado"}
        </button>
      </div>

      {business.approvalStatus === "pending" && (
        <p className="rounded-2xl bg-amber-100 px-4 py-3 text-sm font-bold text-amber-900">
          ⏳ Tu local está en revisión. Aún no es visible para los clientes; te avisaremos cuando lo aprobemos.
        </p>
      )}
      {business.approvalStatus === "rejected" && (
        <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
          Tu local fue rechazado{business.approvalNote ? `: ${business.approvalNote}` : "."}
        </p>
      )}

      <BusinessLogoCard imageUrl={business.imageUrl} emoji={business.emoji} />

      <LocationCard business={business} />

      <DeliveryRulesCard business={business} />

      <WalletCard />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Ventas de hoy (sin envío)" value={money(stats.data?.todaySales ?? 0)} />
        <Stat label="Entregados hoy" value={`${stats.data?.todayDelivered ?? 0} de ${stats.data?.todayOrders ?? 0}`} />
        <Stat label="Activos ahora" value={String(stats.data?.activeOrders ?? 0)} />
        <Stat label="Ventas totales (sin envío)" value={money(stats.data?.revenue ?? 0)} />
        <Stat label="Pedidos totales" value={String(stats.data?.totalOrders ?? 0)} />
        <Stat label="Rescates" value={String(stats.data?.rescues ?? 0)} />
        <Stat label="Calificación" value={stats.data?.ratingCount ? `⭐ ${stats.data.rating.toFixed(1)} (${stats.data.ratingCount})` : "Sin calificaciones"} />
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1 sm:grid-cols-4">
        {(
          [
            ["pedidos", "🧾 Pedidos"],
            ["menu", "🍽️ Menú"],
            ["rescate", "🧡 Rescate"],
            ["resenas", "⭐ Reseñas"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl py-2 text-xs font-extrabold transition-colors md:text-sm ${
              tab === t ? "bg-card shadow-sm" : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pedidos" && <OrdersTab businessId={businessId} />}
      {tab === "menu" && <MenuTab />}
      {tab === "rescate" && <RescueTab />}
      {tab === "resenas" && <ReviewsTab />}
    </div>
  );
}

function BusinessLogoCard({ imageUrl, emoji }: { imageUrl: string | null; emoji: string }) {
  const utils = trpc.useUtils();
  const createImageUpload = trpc.business.createImageUpload.useMutation();
  const setBusinessImage = trpc.business.setBusinessImage.useMutation({
    onError: (e) => toast.error(e.message),
  });
  // Mientras se sube una foto nueva se muestra esa; si no, la guardada.
  const [pending, setPending] = useState<string | null>(null);
  const busy = createImageUpload.isPending || setBusinessImage.isPending;

  async function refresh() {
    await utils.business.myBusiness.invalidate();
    void utils.catalog.invalidate();
  }

  return (
    <section className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
      <BusinessImageField
        previewUrl={pending ?? imageUrl}
        emoji={emoji}
        busy={busy}
        onSelect={async (dataUrl) => {
          setPending(dataUrl);
          try {
            const url = await uploadCompressedImage(dataUrl, "business-logo", createImageUpload.mutateAsync);
            await setBusinessImage.mutateAsync({ imageUrl: url });
            await refresh();
            toast.success("Foto del local actualizada");
          } finally {
            setPending(null);
          }
        }}
        onRemove={async () => {
          await setBusinessImage.mutateAsync({ imageUrl: null });
          await refresh();
          toast.success("Foto quitada: se mostrará el emoji");
        }}
      />
    </section>
  );
}

function LocationCard({ business }: { business: { locationConfirmed: boolean; lat: number; lng: number } }) {
  const utils = trpc.useUtils();
  const [loc, setLoc] = useState<Point | null>(business.locationConfirmed ? { lat: business.lat, lng: business.lng } : null);
  const save = trpc.business.setLocation.useMutation({
    onSuccess: (r) => {
      if (r.needsReview) toast.warning("Moviste el local: el equipo lo revisará de nuevo antes de que vuelva a ser visible.");
      else toast.success("Ubicación guardada");
      utils.business.myBusiness.invalidate();
      utils.catalog.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const changed = !!loc && (!business.locationConfirmed || loc.lat !== business.lat || loc.lng !== business.lng);
  const body = (
    <div className="mt-3 space-y-3">
      <LocationPicker value={loc} onChange={setLoc} />
      <button
        disabled={save.isPending || !changed || !loc || !isInServiceArea(loc.lat, loc.lng)}
        onClick={() => loc && save.mutate(loc)}
        className="w-full rounded-xl bg-brand py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
      >
        {save.isPending ? "Guardando…" : "Guardar ubicación"}
      </button>
      {business.locationConfirmed && (
        <p className="text-[11px] text-muted-foreground">
          Si mueves el pin más de {BUSINESS_RULES.locationReviewMeters} m, tu local vuelve a revisión.
        </p>
      )}
    </div>
  );
  if (!business.locationConfirmed) {
    return (
      <section className="rounded-2xl bg-amber-100 p-4 text-amber-950">
        <p className="text-sm font-extrabold">📍 Marca la ubicación real de tu local</p>
        <p className="mt-1 text-xs font-semibold">
          Hasta que lo hagas tu local no aparece para los clientes, no recibe pedidos y no puede aprobarse. El costo de envío y la ruta del repartidor dependen de este punto.
        </p>
        {body}
      </section>
    );
  }
  return (
    <details className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <summary className="cursor-pointer text-sm font-extrabold">📍 Ubicación del local ✅ confirmada</summary>
      {body}
    </details>
  );
}

function ReviewsTab() {
  const reviews = trpc.business.reviews.useQuery(undefined, { refetchInterval: 60_000 });
  if (reviews.isLoading) return <div className="h-32 animate-pulse rounded-2xl bg-muted" />;
  if (reviews.isError) return <p className="rounded-2xl bg-destructive/10 p-4 text-sm">No se pudieron cargar las reseñas. Intenta nuevamente.</p>;
  if (!reviews.data?.length) return <div className="rounded-2xl border border-dashed p-8 text-center"><p className="text-3xl">⭐</p><h2 className="mt-2 font-extrabold">Todavía no tienes reseñas</h2><p className="mt-1 text-sm text-muted-foreground">Los comentarios aparecerán aquí cuando tus clientes califiquen pedidos.</p></div>;
  return <div className="space-y-3">
    <div><h2 className="font-display text-lg font-extrabold">Opiniones de tus clientes</h2><p className="text-sm text-muted-foreground">Últimas {reviews.data.length} reseñas (máximo 100).</p></div>
    {reviews.data.map((review) => <article key={review.id} className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{review.customerName || "Cliente"}</p><span aria-label={`${review.businessStars} de 5 estrellas`} className="font-extrabold">{"⭐".repeat(review.businessStars)}<span className="ml-1 text-xs text-muted-foreground">{review.businessStars}/5</span></span></div>
      <p className="mt-2 text-sm">{review.businessComment?.trim() || "El cliente no dejó un comentario escrito."}</p>
      <p className="mt-2 text-xs text-muted-foreground">{new Date(review.createdAt).toLocaleDateString("es-EC", { year: "numeric", month: "short", day: "numeric" })}</p>
    </article>)}
  </div>;
}

function DeliveryRulesCard({
  business,
}: {
  business: { deliveryFee: number; feePerKm: number; deliveryRadiusKm: number; minOrder: number; opensAt: string; closesAt: string };
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    deliveryFee: business.deliveryFee,
    feePerKm: business.feePerKm,
    deliveryRadiusKm: business.deliveryRadiusKm,
    minOrder: business.minOrder,
    opensAt: business.opensAt,
    closesAt: business.closesAt,
  });
  const save = trpc.business.updateRules.useMutation({
    onSuccess: () => {
      toast.success("Reglas de entrega guardadas");
      utils.business.myBusiness.invalidate();
      utils.catalog.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const num = (label: string, key: "deliveryFee" | "feePerKm" | "deliveryRadiusKm" | "minOrder", step: number) => (
    <label className="block">
      <span className="mb-1 block text-xs font-extrabold text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
  const time = (label: string, key: "opensAt" | "closesAt") => (
    <label className="block">
      <span className="mb-1 block text-xs font-extrabold text-muted-foreground">{label}</span>
      <input
        type="time"
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
  return (
    <details className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
      <summary className="cursor-pointer text-sm font-extrabold">
        ⚙️ Horario y reglas de entrega · {business.opensAt}–{business.closesAt} · radio {business.deliveryRadiusKm} km
        {business.minOrder > 0 ? ` · mínimo ${money(business.minOrder)}` : ""}
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {time("Abre a las", "opensAt")}
        {time("Cierra a las", "closesAt")}
        {num("Tarifa base ($)", "deliveryFee", 0.25)}
        {num("Costo por km ($)", "feePerKm", 0.05)}
        {num("Radio de entrega (km)", "deliveryRadiusKm", 0.5)}
        {num("Pedido mínimo ($)", "minOrder", 0.5)}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Envío = tarifa base + costo por km. Horario en hora de Ecuador; si cierras después de medianoche, pon una hora menor que la de apertura.
      </p>
      <button
        disabled={save.isPending}
        onClick={() => save.mutate(form)}
        className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
      >
        {save.isPending ? "Guardando…" : "Guardar reglas"}
      </button>
    </details>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-border">
      <p className="font-display text-xl font-extrabold">{value}</p>
      <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pedidos entrantes
// ---------------------------------------------------------------------------
function OrdersTab({ businessId }: { businessId: number }) {
  void businessId;
  const utils = trpc.useUtils();
  const [pickupCodes, setPickupCodes] = useState<Record<number, string>>({});
  // Minutos de preparación elegidos por pedido al aceptarlo (por defecto, los habituales).
  const [prepChoice, setPrepChoice] = useState<Record<number, number>>({});
  const list = trpc.business.orders.useQuery(
    { activeOnly: true },
    { refetchInterval: 10_000 },
  );
  const pushStatus = trpc.push.status.useQuery(undefined, { retry: false });
  const [soundOn, setSoundOn] = useState(() => typeof window === "undefined" || localStorage.getItem("rescate-business-sound") !== "off");
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try { localStorage.setItem("rescate-business-sound", next ? "on" : "off"); } catch { /* sin almacenamiento: no pasa nada */ }
    if (next) { unlockAudio(); playNewOrderBeep(); } // el clic habilita el audio y sirve de prueba
  };
  const pushOnThisDevice = typeof window !== "undefined" && localStorage.getItem("rescate-push-enabled") === "true";
  useNewOrderAlert(
    list.isSuccess ? list.data.filter((x) => x.order.status === "pending").map((x) => x.order.id) : null,
    soundOn,
  );
  const dialogs = useDialogs();
  const update = trpc.business.updateOrderStatus.useMutation({
    onSuccess: () => {
      utils.business.orders.invalidate();
      utils.business.stats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const NEXT_LABEL: Record<string, string> = {
    accepted: "✅ Aceptar",
    preparing: "🍳 A preparar",
    ready: "📦 Marcar listo",
    delivered: "✔️ Entregado al cliente",
    cancelled: "Cancelar",
  };
  const NEXT_STEP: Record<string, OrderStatusKey> = {
    pending: "accepted",
    accepted: "preparing",
    preparing: "ready",
    ready: "delivered",
  };

  const alertBar = (
    <div className="space-y-2">
      <button
        onClick={toggleSound}
        className={`flex w-full items-center justify-between rounded-2xl px-4 py-2.5 text-xs font-extrabold ring-1 ring-border ${soundOn ? "bg-brand-soft text-brand-dark" : "bg-card text-muted-foreground"}`}
      >
        <span>{soundOn ? "🔔 Sonido de pedidos nuevos: activado" : "🔕 Sonido de pedidos nuevos: desactivado"}</span>
        <span className="underline">{soundOn ? "Silenciar" : "Activar"}</span>
      </button>
      {pushStatus.data?.configured && !pushOnThisDevice && (
        <Link to="/perfil" className="block rounded-2xl bg-amber-100 px-4 py-2.5 text-xs font-bold text-amber-900">
          🔕 Este dispositivo no recibe notificaciones. Actívalas en Perfil para enterarte de pedidos aunque la app esté cerrada.
        </Link>
      )}
    </div>
  );

  if ((list.data?.length ?? 0) === 0) {
    return (
      <div className="space-y-3">
        {alertBar}
        <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">
          <p className="text-4xl">🌤️</p>
          <p className="font-display mt-2 font-extrabold">Sin pedidos activos</p>
          <p className="text-sm text-muted-foreground">
            Cuando entre un pedido aparecerá aquí al instante
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alertBar}
      {list.data!.map(({ order, items }) => {
        const meta =
          ORDER_STATUS_LABELS[order.status as OrderStatusKey] ??
          ORDER_STATUS_LABELS.pending;
        const next = order.type === "delivery" && order.fulfillmentMethod === "pickup" && order.status === "ready"
          ? "delivered"
          : NEXT_STEP[order.status];
        return (
          <div
            key={order.id}
            className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-extrabold">
                  {order.code}{" "}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-extrabold">
                    {meta.label}
                  </span>
                </p>
                <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                  {order.customerName} · {order.customerPhone ?? "sin celular"} ·{" "}
                  {timeAgo(order.createdAt)}
                </p>
              </div>
              <span className="font-display text-lg font-extrabold">
                {money(order.total)}
              </span>
            </div>
            <ul className="mt-2 space-y-0.5 text-xs font-semibold text-muted-foreground">
              {items.map((i) => (
                <li key={i.id}>
                  {i.quantity} × {i.name}
                  {i.options.length > 0 && (
                    <span className="block pl-4 font-bold text-foreground/80">↳ {describeOptions(i.options, money)}</span>
                  )}
                </li>
              ))}
            </ul>
            {order.type === "delivery" && order.fulfillmentMethod === "pickup" ? (
              <p className="mt-2 rounded-xl bg-brand-soft px-3 py-1.5 text-xs font-bold text-brand-dark">🏪 Retiro en local · el cliente recoge el pedido, no requiere repartidor.</p>
            ) : order.type === "delivery" ? (
              <p className="mt-2 rounded-xl bg-secondary px-3 py-1.5 text-xs font-bold">
                🛵 Llevar a: {order.deliveryAddress}
              </p>
            ) : (
              <p className="mt-2 rounded-xl bg-rescue-soft px-3 py-1.5 text-xs font-extrabold text-rescue-dark">
                🧡 Rescate · pide al cliente su código de retiro (6 dígitos)
              </p>
            )}
            {order.notes && (
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                📝 {order.notes}
              </p>
            )}
            {order.type === "delivery" && ["accepted", "preparing"].includes(order.status) && (
              <p className={`mt-2 rounded-xl px-3 py-1.5 text-xs font-bold ${withinMinutes(order.updatedAt, BUSINESS_RULES.businessProgressReminderMin) ? "bg-secondary text-muted-foreground" : "bg-destructive/10 text-destructive"}`}>
                ⏱️ En este estado {timeAgo(order.updatedAt)}
                {!withinMinutes(order.updatedAt, BUSINESS_RULES.businessProgressReminderMin) &&
                  ` · si no avanza, se cancelará solo a los ${BUSINESS_RULES.businessProgressTimeoutMin} min`}
              </p>
            )}
            {order.type === "rescue" && order.status === "ready" && order.needsPickupCode && (
              <div className="mt-3 rounded-xl bg-secondary p-3">
                <label htmlFor={`pickup-code-${order.id}`} className="mb-1 block text-xs font-extrabold">
                  Código de retiro que muestra el cliente
                </label>
                <input
                  id={`pickup-code-${order.id}`}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  disabled={order.codeAttempts >= BUSINESS_RULES.maxCodeAttempts}
                  value={pickupCodes[order.id] ?? ""}
                  onChange={(e) => setPickupCodes((c) => ({ ...c, [order.id]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                  placeholder="6 dígitos"
                  className="w-full rounded-xl border border-border bg-card px-3 py-2 text-center text-lg font-extrabold tracking-[0.35em] outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                />
                {order.codeAttempts >= BUSINESS_RULES.maxCodeAttempts ? (
                  <p className="mt-1 text-xs font-bold text-destructive">🔒 Intentos agotados: el cliente debe generar un código nuevo desde su pedido.</p>
                ) : order.codeAttempts > 0 ? (
                  <p className="mt-1 text-xs font-bold text-amber-800">Intentos fallidos: {order.codeAttempts} de {BUSINESS_RULES.maxCodeAttempts}</p>
                ) : null}
              </div>
            )}
            {order.status === "pending" && order.type === "delivery" && (
              <div className="mt-3 rounded-xl bg-secondary p-3">
                <p className="mb-2 text-xs font-extrabold">⏱️ ¿En cuánto estará listo?</p>
                <div className="flex flex-wrap gap-2">
                  {PREP_MINUTES_OPTIONS.map((m) => {
                    const selected = (prepChoice[order.id] ?? DEFAULT_PREP_MINUTES) === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setPrepChoice((c) => ({ ...c, [order.id]: m }))}
                        className={`rounded-full px-3 py-1.5 text-xs font-extrabold ring-1 ring-border ${selected ? "bg-brand text-white" : "bg-card"}`}
                      >
                        {m} min
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">Se lo mostramos al cliente cuando aceptes el pedido.</p>
              </div>
            )}
            {order.estimatedReadyAt && ["accepted", "preparing"].includes(order.status) && (
              <p className="mt-2 rounded-xl bg-brand-soft px-3 py-1.5 text-xs font-bold text-brand-dark">
                ⏱️ Prometiste tenerlo listo a las {new Date(order.estimatedReadyAt).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              {next && !(order.type === "delivery" && order.fulfillmentMethod === "delivery" && order.status === "ready") && (
                <button
                  disabled={
                    update.isPending ||
                    (next === "delivered" && order.needsPickupCode && ((pickupCodes[order.id] ?? "").length !== 6 || order.codeAttempts >= BUSINESS_RULES.maxCodeAttempts))
                  }
                  onClick={() => update.mutate({
                    orderId: order.id,
                    status: next,
                    ...(next === "accepted" && order.type === "delivery" ? { prepMinutes: prepChoice[order.id] ?? DEFAULT_PREP_MINUTES } : {}),
                    ...(next === "delivered" && order.needsPickupCode ? { pickupCode: pickupCodes[order.id] } : {}),
                  })}
                  className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
                >
                  {NEXT_LABEL[next]}
                </button>
              )}
              {order.type === "delivery" && order.fulfillmentMethod === "delivery" && order.status === "ready" && (
                <div className="flex-1 rounded-xl bg-brand-soft px-3 py-2.5 text-center text-xs font-extrabold text-brand-dark">
                  {order.courierPickupCode ? (
                    <>
                      <p>🔐 Código para entregar al repartidor</p>
                      <p className="mt-1 text-xl tracking-[0.3em]">{order.courierPickupCode}</p>
                      <p className="mt-1 font-semibold">Confírmalo cuando recoja el pedido.</p>
                    </>
                  ) : (
                    <p>Esperando que un repartidor lo tome 🏍️</p>
                  )}
                </div>
              )}
              {(["pending", "accepted"].includes(order.status) || (order.type === "delivery" && order.fulfillmentMethod === "delivery" && ["preparing", "ready"].includes(order.status))) && (
                <button
                  disabled={update.isPending}
                  onClick={async () => {
                    const needsReason = ["preparing", "ready"].includes(order.status);
                    const reason = await dialogs.prompt({
                      title: "Cancelar pedido",
                      description: needsReason ? "Motivo de la cancelación (obligatorio, el cliente lo verá)." : "Motivo de la cancelación (opcional, el cliente lo verá).",
                      placeholder: "Motivo",
                      required: needsReason,
                      minLength: needsReason ? 5 : 0,
                      confirmLabel: "Cancelar pedido",
                    });
                    if (reason === null) return; // el comercio se arrepintió: no cancela
                    update.mutate({ orderId: order.id, status: "cancelled", reason: reason || undefined });
                  }}
                  className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-extrabold text-destructive"
                >
                  Cancelar
                </button>
              )}
            </div>
            {order.status !== "pending" && <ClaimBox orderId={order.id} role="business" collapsible />}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menú (productos)
// ---------------------------------------------------------------------------
function MenuTab() {
  const utils = trpc.useUtils();
  const list = trpc.business.products.useQuery();
  const createImageUpload = trpc.business.createImageUpload.useMutation();
  const optionGroups = trpc.business.optionGroups.useQuery();
  const emptyForm = { name: "", price: "", emoji: "🍽️", description: "", imageUrl: "", optionGroupIds: [] as number[] };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const add = trpc.business.upsertProduct.useMutation({
    onSuccess: () => {
      setForm(emptyForm);
      const wasEditing = editingId !== null;
      setEditingId(null);
      utils.business.products.invalidate();
      utils.business.optionGroups.invalidate();
      utils.catalog.invalidate();
      toast.success(wasEditing ? "Producto actualizado" : "Producto agregado al menú");
    },
    onError: (e) => toast.error(e.message),
  });
  const toggle = trpc.business.toggleProduct.useMutation({
    onSuccess: () => {
      utils.business.products.invalidate();
      utils.catalog.invalidate();
    },
  });

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-3xl bg-card p-4 ring-1 ring-border">
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          {editingId !== null ? "Editar producto del menú" : "Agregar producto al menú"}
        </p>
        <div className="flex gap-2">
          <input
            value={form.emoji}
            onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
            className="w-16 rounded-xl border border-input bg-background px-3 py-2.5 text-center text-lg"
            maxLength={4}
            aria-label="Emoji del producto"
          />
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Nombre (ej. Hamburguesa clásica)"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-semibold outline-none"
            maxLength={150}
          />
          <input
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            placeholder="$0.00"
            type="number"
            min={0.1}
            step={0.25}
            className="w-24 rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-semibold outline-none"
          />
        </div>
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Descripción breve. Ingredientes: pan, carne, queso, lechuga y salsa. Indica alérgenos si aplica."
          maxLength={300}
          rows={3}
          className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none"
        />
        <div className="space-y-2 rounded-2xl border border-dashed border-input p-3">
          <label className="block text-sm font-bold">Opciones del producto (combo)</label>
          {(optionGroups.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Para que el cliente pueda elegir sabor, tamaño o extras, primero crea un grupo en «Opciones de combos» (más abajo) y luego márcalo aquí.
            </p>
          ) : (
            <div className="space-y-1.5">
              {(optionGroups.data ?? []).map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={form.optionGroupIds.includes(g.id)}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      optionGroupIds: e.target.checked ? [...f.optionGroupIds, g.id] : f.optionGroupIds.filter((id) => id !== g.id),
                    }))}
                    className="h-4 w-4 accent-brand"
                  />
                  <span>{g.name}</span>
                  <span className="text-xs font-bold text-muted-foreground">
                    {g.minSelect > 0 ? "obligatorio" : "opcional"} · {g.choices.length} opcion{g.choices.length === 1 ? "" : "es"}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2 rounded-2xl border border-dashed border-input p-3">
          <label className="block text-sm font-bold">Foto del plato (opcional)</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={imageBusy}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!file) return;
              setImageBusy(true);
              try {
                const compressed = await compressProductImage(file);
                const imageUrl = await uploadCompressedImage(compressed, "product", createImageUpload.mutateAsync);
                setForm((f) => ({ ...f, imageUrl }));
                toast.success("Foto subida al almacenamiento y lista para publicar");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "No se pudo cargar la foto");
              } finally {
                setImageBusy(false);
              }
            }}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:font-bold"
          />
          <p className="text-xs text-muted-foreground">JPG, PNG o WebP. Se optimiza en el navegador y se sube al almacenamiento externo.</p>
          {imageBusy && <p className="text-sm font-semibold text-muted-foreground">Optimizando foto…</p>}
          {form.imageUrl && (
            <div className="flex items-center gap-3">
              <img src={form.imageUrl} alt="Vista previa del plato" className="h-20 w-24 rounded-xl object-cover" />
              <button type="button" onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))} className="text-sm font-bold text-destructive">Quitar foto</button>
            </div>
          )}
        </div>
        <button
          disabled={add.isPending || imageBusy || form.name.trim().length < 2 || Number(form.price) <= 0}
          onClick={() => add.mutate({
            ...(editingId !== null ? { id: editingId } : {}),
            name: form.name.trim(),
            price: Number(form.price),
            emoji: form.emoji,
            description: form.description.trim() || undefined,
            imageUrl: form.imageUrl || undefined,
            optionGroupIds: form.optionGroupIds,
          })}
          className="w-full rounded-xl bg-foreground py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
        >
          {add.isPending ? "Guardando…" : editingId !== null ? "Guardar cambios" : "+ Agregar al menú"}
        </button>
        {editingId !== null && (
          <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }} className="w-full rounded-xl border border-input py-2 text-sm font-bold">Cancelar edición</button>
        )}
      </div>

      <OptionGroupsManager />

      {(list.data ?? []).map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
          {p.imageUrl ? (
            <img src={p.imageUrl} alt={p.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-secondary text-2xl">{p.emoji}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">{p.name}</p>
            <p className="text-xs font-bold text-muted-foreground">{money(p.price)}</p>
            {p.description && <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
            {p.optionGroupIds.length > 0 && (
              <p className="text-[11px] font-extrabold text-brand-dark">🧩 Combo con {p.optionGroupIds.length} grupo{p.optionGroupIds.length === 1 ? "" : "s"} de opciones</p>
            )}
          </div>
          <button
            onClick={() => {
              setEditingId(p.id);
              setForm({ name: p.name, price: String(p.price), emoji: p.emoji, description: p.description ?? "", imageUrl: p.imageUrl ?? "", optionGroupIds: p.optionGroupIds });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="shrink-0 rounded-full border border-input px-3 py-1.5 text-[11px] font-extrabold"
          >
            Editar
          </button>
          <button
            onClick={() => toggle.mutate({ id: p.id, isAvailable: !p.isAvailable })}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold ${p.isAvailable ? "bg-brand-soft text-brand-dark" : "bg-secondary text-muted-foreground"}`}
          >
            {p.isAvailable ? "Disponible" : "Agotado"}
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Packs de rescate
// ---------------------------------------------------------------------------
function RescueTab() {
  const utils = trpc.useUtils();
  const list = trpc.business.rescuePacks.useQuery();
  const createImageUpload = trpc.business.createImageUpload.useMutation();
  const [form, setForm] = useState({
    title: "",
    description: "",
    imageUrl: "",
    originalPrice: "",
    rescuePrice: "",
    quantityTotal: "5",
    pickupStart: "19:00",
    pickupEnd: "20:30",
  });
  const [imageBusy, setImageBusy] = useState(false);
  const add = trpc.business.createRescuePack.useMutation({
    onSuccess: () => {
      setForm((f) => ({ ...f, title: "", description: "", imageUrl: "", originalPrice: "", rescuePrice: "" }));
      utils.business.rescuePacks.invalidate();
      utils.catalog.invalidate();
      toast.success("Pack publicado");
    },
    onError: (e) => toast.error(e.message),
  });
  const toggle = trpc.business.toggleRescuePack.useMutation({
    onSuccess: () => {
      utils.business.rescuePacks.invalidate();
      utils.catalog.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const republish = trpc.business.republishRescuePack.useMutation({
    onSuccess: (r) => {
      utils.business.rescuePacks.invalidate();
      utils.catalog.invalidate();
      toast.success(`Pack publicado de nuevo: vence ${describePackExpiry(r.expiresAt)}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-3xl bg-rescue-soft p-4 ring-1 ring-rescue/20">
        <p className="text-xs font-extrabold uppercase tracking-wide text-rescue-dark">
          Publicar pack de rescate 🧡
        </p>
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="Ej: Pack Pan del Día"
          className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold outline-none"
        />
        <input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Qué incluye (aprox.)"
          className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold outline-none"
        />
        <div className="space-y-2 rounded-2xl border border-dashed border-input bg-card p-3">
          <label className="block text-sm font-bold">Foto del pack (opcional)</label>
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={imageBusy}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (!file) return;
              setImageBusy(true);
              try { const compressed = await compressProductImage(file); const imageUrl = await uploadCompressedImage(compressed, "rescue-pack", createImageUpload.mutateAsync); setForm((f) => ({ ...f, imageUrl })); toast.success("Foto del pack subida al almacenamiento"); }
              catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo cargar la foto"); }
              finally { setImageBusy(false); }
            }} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:font-bold" />
          {imageBusy && <p className="text-xs text-muted-foreground">Optimizando foto…</p>}
          {form.imageUrl && <div className="flex items-center gap-3"><img src={form.imageUrl} alt="Vista previa del pack" className="h-20 w-24 rounded-xl object-cover" /><button type="button" onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))} className="text-sm font-bold text-destructive">Quitar foto</button></div>}
          <p className="text-xs text-muted-foreground">JPG, PNG o WebP. Se optimiza y se sube al almacenamiento externo.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input
            value={form.originalPrice}
            onChange={(e) => setForm((f) => ({ ...f, originalPrice: e.target.value }))}
            placeholder="$ normal"
            type="number"
            min={0}
            step={0.5}
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold outline-none"
          />
          <input
            value={form.rescuePrice}
            onChange={(e) => setForm((f) => ({ ...f, rescuePrice: e.target.value }))}
            placeholder="$ rescate"
            type="number"
            min={0}
            step={0.5}
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold outline-none"
          />
          <input
            value={form.quantityTotal}
            onChange={(e) => setForm((f) => ({ ...f, quantityTotal: e.target.value }))}
            placeholder="Cant."
            type="number"
            min={1}
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-extrabold text-rescue-dark">
              Retiro desde
            </span>
            <input
              type="time"
              value={form.pickupStart}
              onChange={(e) => setForm((f) => ({ ...f, pickupStart: e.target.value }))}
              className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-extrabold text-rescue-dark">
              Hasta
            </span>
            <input
              type="time"
              value={form.pickupEnd}
              onChange={(e) => setForm((f) => ({ ...f, pickupEnd: e.target.value }))}
              className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold outline-none"
            />
          </label>
        </div>
        {/^\d{2}:\d{2}$/.test(form.pickupStart) && /^\d{2}:\d{2}$/.test(form.pickupEnd) && (
          <p className="text-[11px] font-bold text-rescue-dark">
            ⏳ Este pack se podrá reservar hasta {describePackExpiry(computePackExpiry(form.pickupStart, form.pickupEnd))}. Después vence y tendrás que republicarlo.
          </p>
        )}
        <button
          disabled={
            add.isPending || imageBusy ||
            form.title.length < 2 ||
            Number(form.originalPrice) <= 0 ||
            Number(form.rescuePrice) <= 0
          }
          onClick={() =>
            add.mutate({
              title: form.title,
              description: form.description || undefined,
              imageUrl: form.imageUrl || undefined,
              originalPrice: Number(form.originalPrice),
              rescuePrice: Number(form.rescuePrice),
              quantityTotal: Number(form.quantityTotal) || 1,
              pickupStart: form.pickupStart,
              pickupEnd: form.pickupEnd,
            })
          }
          className="w-full rounded-xl bg-rescue py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
        >
          Publicar pack
        </button>
      </div>

      {(list.data ?? []).map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border"
        >
          {p.imageUrl ? <img src={p.imageUrl} alt={p.title} className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-rescue-soft text-2xl">🧡</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">{p.title}</p>
            <p className="text-xs font-bold text-muted-foreground">
              {money(p.rescuePrice)} · quedan {p.quantityLeft}/{p.quantityTotal} ·{" "}
              {p.pickupStart}–{p.pickupEnd}
            </p>
            <p className={`text-[11px] font-bold ${p.expired ? "text-destructive" : "text-muted-foreground"}`}>
              {p.expired ? "⏳ Venció: publícalo de nuevo para que vuelva a verse" : `⏳ Vence ${describePackExpiry(p.expiresAt)}`}
            </p>
          </div>
          {p.expired ? (
            <button
              disabled={republish.isPending}
              onClick={() => republish.mutate({ id: p.id })}
              className="rounded-full bg-rescue px-3 py-1.5 text-[11px] font-extrabold text-white disabled:opacity-50"
            >
              Republicar
            </button>
          ) : (
            <button
              onClick={() => toggle.mutate({ id: p.id, isActive: !p.isActive })}
              className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold ${
                p.isActive
                  ? "bg-rescue-soft text-rescue-dark"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {p.isActive ? "Activo" : "Pausado"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
