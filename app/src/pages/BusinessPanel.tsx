import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { money, timeAgo } from "@/lib/format";
import {
  BUSINESS_CATEGORIES,
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

  return <Panel businessId={myBusiness.data.id} isOpen={myBusiness.data.isOpen} businessName={myBusiness.data.name} />;
}

// ---------------------------------------------------------------------------
// Registro del local
// ---------------------------------------------------------------------------
function BusinessSetup() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "comida-rapida",
    address: "",
    phone: "",
    emoji: "🍽️",
    deliveryFee: 1,
    deliveryMinutes: 30,
  });
  const save = trpc.business.upsertBusiness.useMutation({
    onSuccess: () => {
      toast.success("¡Tu local está en línea!");
      utils.business.myBusiness.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const field = (
    label: string,
    key: keyof typeof form,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label className="block">
      <span className="mb-1 block text-xs font-extrabold text-muted-foreground">
        {label}
      </span>
      <input
        {...props}
        value={form[key] as string | number}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            [key]: props.type === "number" ? Number(e.target.value) : e.target.value,
          }))
        }
        className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold">
          Registra tu local 🏪
        </h1>
        <p className="text-sm font-semibold text-muted-foreground">
          En 1 minuto empiezas a vender en Milagro
        </p>
      </div>
      <div className="space-y-3 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        {field("Nombre del local", "name", { placeholder: "Panadería El Trigal" })}
        {field("Descripción corta", "description", {
          placeholder: "Qué vendes y qué te hace especial",
        })}
        <label className="block">
          <span className="mb-1 block text-xs font-extrabold text-muted-foreground">
            Categoría
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
        })}
        <div className="grid grid-cols-2 gap-3">
          {field("Tarifa de envío ($)", "deliveryFee", {
            type: "number",
            min: 0,
            step: 0.25,
          })}
          {field("Tiempo de entrega (min)", "deliveryMinutes", {
            type: "number",
            min: 5,
          })}
        </div>
        {field("Emoji de tu local", "emoji", { placeholder: "🍕", maxLength: 4 })}
        <button
          disabled={save.isPending || form.name.length < 2 || form.address.length < 5}
          onClick={() => save.mutate(form)}
          className="w-full rounded-2xl bg-brand py-3.5 font-display text-base font-extrabold text-white disabled:opacity-50"
        >
          {save.isPending ? "Guardando…" : "Abrir mi local"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel con pestañas
// ---------------------------------------------------------------------------
type Tab = "pedidos" | "menu" | "rescate";

function Panel({
  businessId,
  isOpen,
  businessName,
}: {
  businessId: number;
  isOpen: boolean;
  businessName: string;
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pedidos totales" value={String(stats.data?.totalOrders ?? 0)} />
        <Stat label="Activos ahora" value={String(stats.data?.activeOrders ?? 0)} />
        <Stat label="Ingresos" value={money(stats.data?.revenue ?? 0)} />
        <Stat label="Rescates" value={String(stats.data?.rescues ?? 0)} />
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-secondary p-1">
        {(
          [
            ["pedidos", "🧾 Pedidos"],
            ["menu", "🍽️ Menú"],
            ["rescate", "🧡 Rescate"],
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
    </div>
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
  const list = trpc.business.orders.useQuery(
    { activeOnly: true },
    { refetchInterval: 10_000 },
  );
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

  if ((list.data?.length ?? 0) === 0) {
    return (
      <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">
        <p className="text-4xl">🌤️</p>
        <p className="font-display mt-2 font-extrabold">Sin pedidos activos</p>
        <p className="text-sm text-muted-foreground">
          Cuando entre un pedido aparecerá aquí al instante
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {list.data!.map(({ order, items }) => {
        const meta =
          ORDER_STATUS_LABELS[order.status as OrderStatusKey] ??
          ORDER_STATUS_LABELS.pending;
        const next = NEXT_STEP[order.status];
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
                </li>
              ))}
            </ul>
            {order.type === "delivery" ? (
              <p className="mt-2 rounded-xl bg-secondary px-3 py-1.5 text-xs font-bold">
                🛵 Llevar a: {order.deliveryAddress}
              </p>
            ) : (
              <p className="mt-2 rounded-xl bg-rescue-soft px-3 py-1.5 text-xs font-extrabold text-rescue-dark">
                🧡 Rescate · código de retiro: {order.pickupCode}
              </p>
            )}
            {order.notes && (
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                📝 {order.notes}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              {next && !(order.type === "delivery" && order.status === "ready") && (
                <button
                  disabled={update.isPending}
                  onClick={() => update.mutate({ orderId: order.id, status: next })}
                  className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
                >
                  {NEXT_LABEL[next]}
                </button>
              )}
              {order.type === "delivery" && order.status === "ready" && (
                <p className="flex-1 rounded-xl bg-brand-soft py-2.5 text-center text-xs font-extrabold text-brand-dark">
                  Esperando que un repartidor lo tome 🏍️
                </p>
              )}
              {["pending", "accepted"].includes(order.status) && (
                <button
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({ orderId: order.id, status: "cancelled" })
                  }
                  className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-extrabold text-destructive"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menú (productos)
// ---------------------------------------------------------------------------
async function compressProductImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona un archivo de imagen.");
  if (file.size > 10 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 10 MB.");
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo leer la imagen."));
      img.src = source;
    });
    const scale = Math.min(1, 900 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo procesar la imagen.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL("image/jpeg", 0.68);
    if (result.length > 450_000) result = canvas.toDataURL("image/jpeg", 0.48);
    if (result.length > 500_000) throw new Error("La imagen sigue siendo muy pesada. Prueba con otra foto.");
    return result;
  } finally {
    URL.revokeObjectURL(source);
  }
}

type ImageUploadInput = {
  contentType: "image/jpeg";
  kind: "product" | "rescue-pack";
};
type ImageUploadResult = { uploadUrl: string; imageUrl: string };

async function uploadCompressedImage(
  dataUrl: string,
  kind: ImageUploadInput["kind"],
  createUpload: (input: ImageUploadInput) => Promise<ImageUploadResult>,
): Promise<string> {
  const blob = await fetch(dataUrl).then((response) => response.blob());
  if (blob.type !== "image/jpeg") throw new Error("La imagen optimizada no tiene un formato válido.");
  const target = await createUpload({ contentType: "image/jpeg", kind });
  const response = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
  if (!response.ok) throw new Error("No se pudo guardar la imagen en el almacenamiento. Revisa el bucket y su configuración CORS.");
  return target.imageUrl;
}

function MenuTab() {
  const utils = trpc.useUtils();
  const list = trpc.business.products.useQuery();
  const createImageUpload = trpc.business.createImageUpload.useMutation();
  const emptyForm = { name: "", price: "", emoji: "🍽️", description: "", imageUrl: "" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const add = trpc.business.upsertProduct.useMutation({
    onSuccess: () => {
      setForm(emptyForm);
      const wasEditing = editingId !== null;
      setEditingId(null);
      utils.business.products.invalidate();
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
          placeholder="Descripción e ingredientes (ej. pan, carne, queso, lechuga, tomate y salsa de la casa). Indica alérgenos si aplica."
          maxLength={300}
          rows={3}
          className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none"
        />
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
          })}
          className="w-full rounded-xl bg-foreground py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
        >
          {add.isPending ? "Guardando…" : editingId !== null ? "Guardar cambios" : "+ Agregar al menú"}
        </button>
        {editingId !== null && (
          <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }} className="w-full rounded-xl border border-input py-2 text-sm font-bold">Cancelar edición</button>
        )}
      </div>

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
          </div>
          <button
            onClick={() => {
              setEditingId(p.id);
              setForm({ name: p.name, price: String(p.price), emoji: p.emoji, description: p.description ?? "", imageUrl: p.imageUrl ?? "" });
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
          </div>
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
        </div>
      ))}
    </div>
  );
}
