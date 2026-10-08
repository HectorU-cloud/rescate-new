import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { APP_ROLES, type AppRole } from "@contracts/constants";
import { toast } from "sonner";

export default function Profile() {
  const { user, isAuthenticated, logout, refresh } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const navigate = useNavigate();
  const [phone, setPhone] = useState(user?.phone ?? "");
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
        onClick={() => logout()}
        className="w-full rounded-2xl bg-card py-3.5 text-sm font-extrabold text-destructive ring-1 ring-border"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
