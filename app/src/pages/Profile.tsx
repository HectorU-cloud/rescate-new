import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { APP_ROLES, type AppRole } from "@contracts/constants";
import { toast } from "sonner";
import { getFirebaseVapidKey, getFirebaseWebConfig, loadPushClient } from "@/lib/push-client";

export default function Profile() {
  const { user, isAuthenticated, logout, refresh } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const navigate = useNavigate();
  const [phone, setPhone] = useState(user?.phone ?? "");
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
          <p className="truncate text-sm font-semibold text-muted-foreground">
            {user.email}
          </p>
        </div>
      </section>

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
