import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { APP_ROLES, type AppRole } from "@contracts/constants";
import { toast } from "sonner";

export default function Onboarding() {
  const { user, isAuthenticated, refresh } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });
  const navigate = useNavigate();
  const setRole = trpc.profile.setAppRole.useMutation({
    onSuccess: async () => {
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!isAuthenticated || !user) return null;
  if (user.appRole) {
    navigate("/", { replace: true });
    return null;
  }

  const choose = (role: AppRole) => {
    setRole.mutate(
      { appRole: role },
      {
        onSuccess: async () => {
          await refresh();
          navigate(
            role === "business"
              ? "/panel"
              : role === "courier"
                ? "/repartidor"
                : "/",
          );
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-lg space-y-5 py-4">
      <div className="text-center">
        <span className="text-5xl">🛵</span>
        <h1 className="font-display mt-2 text-2xl font-extrabold">
          ¡Hola, {user.name?.split(" ")[0] ?? "amigo"}!
        </h1>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">
          ¿Cómo quieres usar Al Rescate?
        </p>
      </div>
      <div className="space-y-3">
        {APP_ROLES.map((r) => (
          <button
            key={r.id}
            disabled={setRole.isPending}
            onClick={() => choose(r.id)}
            className="flex w-full items-center gap-4 rounded-3xl bg-card p-5 text-left shadow-sm ring-1 ring-border transition-all hover:ring-2 hover:ring-brand active:scale-[0.98] disabled:opacity-50"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-soft text-3xl">
              {r.emoji}
            </span>
            <span>
              <span className="font-display block text-lg font-extrabold">
                {r.label}
              </span>
              <span className="block text-xs font-semibold text-muted-foreground">
                {r.desc}
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-center text-xs font-semibold text-muted-foreground">
        Puedes cambiar de rol después desde tu perfil (útil para probar la demo)
      </p>
    </div>
  );
}
