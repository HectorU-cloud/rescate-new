import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { APP_ROLES, type AppRole } from "@contracts/constants";
import { toast } from "sonner";
import { Camera, ShieldCheck } from "lucide-react";
import { getFirebaseVapidKey, getFirebaseWebConfig, loadPushClient } from "@/lib/push-client";

export default function Profile() {
  const { user, isAuthenticated, logout, refresh } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const navigate = useNavigate();
  const [phone, setPhone] = useState(user?.phone ?? "");
  const courierProfile = trpc.profile.courierProfile.useQuery(undefined, { enabled: isAuthenticated });
  const [vehicle, setVehicle] = useState("");
  const [plate, setPlate] = useState("");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const saveCourierProfile = trpc.profile.updateCourierProfile.useMutation({ onSuccess: () => { void courierProfile.refetch(); toast.success("Perfil de repartidor guardado"); }, onError: (e) => toast.error(e.message) });
  const createCourierPhotoUpload = trpc.profile.createCourierPhotoUpload.useMutation();
  useEffect(() => {
    if (courierProfile.data) {
      setVehicle(courierProfile.data.courierVehicle ?? "");
      setPlate(courierProfile.data.courierPlate ?? "");
      setBio(courierProfile.data.courierBio ?? "");
      setPhotoUrl(courierProfile.data.courierPhotoUrl ?? "");
    }
  }, [courierProfile.data]);

  const uploadCourierPhoto = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { toast.error("Usa una imagen JPG, PNG o WebP."); return; }
    setPhotoBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo procesar la fotografía.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("No se pudo comprimir la imagen.")), "image/webp", 0.82));
      const signed = await createCourierPhotoUpload.mutateAsync({ contentType: "image/webp" });
      const response = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/webp" }, body: blob });
      if (!response.ok) throw new Error("Falló la subida a R2. Revisa la configuración CORS del bucket.");
      setPhotoUrl(signed.imageUrl);
      toast.success("Foto subida. Pulsa Guardar perfil para confirmar.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo subir la foto."); }
    finally { setPhotoBusy(false); }
  };
  const [pushBusy, setPushBusy] = useState(false);
  const pushStatus = trpc.push.status.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const registerPush = trpc.push.register.useMutation({ onError: (e) => toast.error(e.message) });
  const unregisterPush = trpc.push.unregister.useMutation({ onError: (e) => toast.error(e.message) });
  const firebaseConfig = getFirebaseWebConfig();
  const vapidKey = getFirebaseVapidKey();
  const firebaseWebConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId && vapidKey);
  const [pushEnabled, setPushEnabled] = useState(() => typeof window !== "undefined" && localStorage.getItem("rescate-push-enabled") === "true");

  const enablePush = async () => {
    if (!firebaseWebConfigured) { toast.error("Falta configurar VITE_FIREBASE_* y VITE_FIREBASE_VAPID_KEY en .env."); return; }
    if (!pushStatus.data?.configured) { toast.error("Falta configurar FIREBASE_SERVICE_ACCOUNT_JSON en el backend."); return; }
    setPushBusy(true);
    try {
      const client = await loadPushClient();
      const token = await client.enable(firebaseConfig, vapidKey);
      await registerPush.mutateAsync({ token, platform: "web" });
      localStorage.setItem("rescate-push-token", token);
      localStorage.setItem("rescate-push-enabled", "true");
      setPushEnabled(true);
      toast.success("Notificaciones activadas en este dispositivo");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron activar las notificaciones."); }
    finally { setPushBusy(false); }
  };

  const disablePush = async () => {
    setPushBusy(true);
    try {
      const token = localStorage.getItem("rescate-push-token");
      if (token) await unregisterPush.mutateAsync({ token });
      localStorage.removeItem("rescate-push-token");
      localStorage.removeItem("rescate-push-enabled");
      setPushEnabled(false);
      toast.success("Este dispositivo ya no recibirá notificaciones de Rescate");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo desactivar el registro."); }
    finally { setPushBusy(false); }
  };

  const logoutSafely = async () => {
    const token = localStorage.getItem("rescate-push-token");
    if (token) {
      try { await unregisterPush.mutateAsync({ token }); } catch { /* La sesión debe poder cerrarse aunque falle la limpieza del token. */ }
    }
    localStorage.removeItem("rescate-push-token");
    localStorage.removeItem("rescate-push-enabled");
    await logout();
  };

  const setRole = trpc.profile.setAppRole.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Rol actualizado");
    },
    onError: (e) => toast.error(e.message),
  });
  const savePhone = trpc.profile.updatePhone.useMutation({
    onSuccess: () => toast.success("Celular guardado"),
    onError: (e) => toast.error(e.message),
  });

  if (!isAuthenticated || !user) return null;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <section className="flex items-center gap-4 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-brand-soft text-2xl font-extrabold text-brand-dark">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            (user.name ?? "A")[0]
          )}
        </span>
        <div className="min-w-0">
          <h1 className="font-display truncate text-xl font-extrabold">
            {user.name ?? "Usuario"}
          </h1>
          <p className="truncate text-sm font-semibold text-muted-foreground">{user.email}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {user.role === "admin" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800">🛡️ Administrador</span>}
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">Modo: {user.appRole ?? "sin configurar"}</span>
          </div>
        </div>
      </section>

      {user.appRole === "courier" && (
        <section className="space-y-4 rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
          <div className="flex items-center gap-2"><Camera className="h-5 w-5 text-brand" /><h2 className="font-display text-base font-extrabold">Mi perfil de repartidor</h2></div>
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 overflow-hidden rounded-full bg-secondary ring-1 ring-border">{photoUrl ? <img src={photoUrl} alt="Foto de perfil del repartidor" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-2xl">🏍️</div>}</div>
            <label className="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-secondary">{photoBusy ? "Subiendo…" : "Subir fotografía"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={photoBusy} onChange={(e) => { void uploadCourierPhoto(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>
          </div>
          <p className="text-xs text-muted-foreground">La foto se comprime en el navegador y se sube directamente a R2 mediante una URL temporal.</p>
          <label className="block text-xs font-bold">Vehículo<input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Ej. Motocicleta negra" maxLength={80} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-medium" /></label>
          <label className="block text-xs font-bold">Placa (opcional)<input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Ej. GBA-1234" maxLength={20} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-medium" /></label>
          <label className="block text-xs font-bold">Presentación<textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Cuéntales algo breve a tus clientes…" maxLength={300} rows={3} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-medium" /></label>
          <div className="flex items-center gap-2 rounded-xl bg-secondary p-3 text-xs font-semibold"> <ShieldCheck className="h-4 w-4" /> Estado de revisión: {courierProfile.data?.courierApproved ? "Aprobado" : "Pendiente de revisión administrativa"}</div>
          <button onClick={() => saveCourierProfile.mutate({ photoUrl: photoUrl || undefined, vehicle, plate, bio })} disabled={saveCourierProfile.isPending || photoBusy} className="w-full rounded-xl bg-brand py-3 text-sm font-extrabold text-white disabled:opacity-50">{saveCourierProfile.isPending ? "Guardando…" : "Guardar perfil de repartidor"}</button>
        </section>
      )}

      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <h2 className="font-display text-base font-extrabold">Tu celular</h2>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          Lo usan el local y el repartidor para coordinar contigo
        </p>
        <div className="flex gap-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0991234567"
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => savePhone.mutate({ phone })}
            disabled={phone.trim().length < 6 || savePhone.isPending}
            className="shrink-0 rounded-xl bg-brand px-5 text-sm font-extrabold text-white disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </section>

      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <h2 className="font-display text-base font-extrabold">Notificaciones push</h2>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">Recibe avisos cuando el local confirme tu pedido, lo preparen o el repartidor salga en camino. Actívalas en cada dispositivo que utilices.</p>
        {!firebaseWebConfigured && <p className="mt-3 rounded-xl bg-secondary p-3 text-xs font-semibold text-muted-foreground">Pendiente de configurar Firebase Web en las variables VITE_FIREBASE_* del archivo .env.</p>}
        {!pushStatus.data?.configured && <p className="mt-2 rounded-xl bg-secondary p-3 text-xs font-semibold text-muted-foreground">El servidor aún no tiene FIREBASE_SERVICE_ACCOUNT_JSON configurado.</p>}
        <button onClick={() => pushEnabled ? void disablePush() : void enablePush()} disabled={pushBusy || pushStatus.isLoading} className="mt-3 w-full rounded-xl bg-brand py-3 text-sm font-extrabold text-white disabled:opacity-50">
          {pushBusy ? "Procesando…" : pushEnabled ? "Desactivar notificaciones en este dispositivo" : "Activar notificaciones"}
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground">Requiere HTTPS (o localhost), permiso del navegador y configuración de Firebase Cloud Messaging.</p>
      </section>

      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
        <h2 className="font-display text-base font-extrabold">Modo de la app</h2>
        <p className="mb-3 text-xs font-semibold text-muted-foreground">
          Cambia de rol para probar la demo completa con esta misma cuenta
        </p>
        <div className="grid grid-cols-3 gap-2">
          {APP_ROLES.map((r) => (
            <button
              key={r.id}
              disabled={setRole.isPending}
              onClick={() => setRole.mutate({ appRole: r.id as AppRole })}
              className={`rounded-2xl p-3 text-center ring-1 transition-colors ${
                user.appRole === r.id
                  ? "bg-brand-soft ring-2 ring-brand"
                  : "bg-secondary ring-border"
              }`}
            >
              <span className="block text-2xl">{r.emoji}</span>
              <span className="mt-1 block text-[11px] font-extrabold leading-tight">
                {r.label}
              </span>
            </button>
          ))}
        </div>
        {user.appRole === "business" && (
          <button
            onClick={() => navigate("/panel")}
            className="mt-3 w-full rounded-xl bg-foreground py-3 text-sm font-extrabold text-white"
          >
            Ir al panel de mi local →
          </button>
        )}
        {user.appRole === "courier" && (
          <button
            onClick={() => navigate("/repartidor")}
            className="mt-3 w-full rounded-xl bg-foreground py-3 text-sm font-extrabold text-white"
          >
            Ir a mis repartos →
          </button>
        )}
      </section>

      <button
        onClick={() => void logoutSafely()}
        className="w-full rounded-2xl bg-card py-3.5 text-sm font-extrabold text-destructive ring-1 ring-border"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
