import { useDialogs } from "@/providers/dialogs";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";

export default function AdminCourierReview() {
  const { user, isAuthenticated } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const utils = trpc.useUtils();
  const pending = trpc.profile.pendingCouriers.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin", refetchInterval: 15000 });
  const dialogs = useDialogs();
  const review = trpc.profile.reviewCourierVerification.useMutation({ onSuccess: () => { toast.success("Revisión guardada"); utils.profile.pendingCouriers.invalidate(); }, onError: (e) => toast.error(e.message) });
  if (!isAuthenticated) return null;
  if (user?.role !== "admin") return <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">Esta sección es exclusiva para administradores.</div>;
  return <div className="mx-auto max-w-3xl space-y-4"><header><h1 className="font-display text-2xl font-extrabold">Verificación de repartidores</h1><p className="text-sm text-muted-foreground">Revisa la información antes de habilitar al repartidor para aceptar entregas.</p></header>
    {(pending.data ?? []).length === 0 ? <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">No hay perfiles pendientes.</div> : pending.data!.map((c) => <article key={c.id} className="space-y-3 rounded-3xl bg-card p-5 ring-1 ring-border"><div className="flex items-center gap-3">{c.photoUrl ? <img src={c.photoUrl} alt="Foto de perfil" className="h-16 w-16 rounded-2xl object-cover"/> : <span className="grid h-16 w-16 place-items-center rounded-2xl bg-secondary text-2xl">🛵</span>}<div><h2 className="font-extrabold">{c.name ?? "Sin nombre"}</h2><p className="text-sm text-muted-foreground">{c.email ?? "Sin correo"} · {c.phone ?? "Sin teléfono"}</p></div></div><div className="grid gap-2 text-sm sm:grid-cols-2"><p><b>Vehículo:</b> {c.vehicle ?? "No indicado"}</p><p><b>Placa:</b> {c.plate ?? "No indicada"}</p><p className="sm:col-span-2"><b>Presentación:</b> {c.bio ?? "No indicada"}</p></div><div className="flex flex-wrap gap-2"><button disabled={review.isPending} onClick={() => review.mutate({ userId: c.id, decision: "approved" })} className="rounded-xl bg-brand px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50">Aprobar repartidor</button><button disabled={review.isPending} onClick={async () => { const note = await dialogs.prompt({ title: "Motivo del rechazo", description: "Lo verá el repartidor.", placeholder: "Qué debe corregir", required: false, minLength: 0, confirmLabel: "Rechazar" }); if (note === null) return; /* Cancelar: no se rechaza */ review.mutate({ userId: c.id, decision: "rejected", note: note || "Datos por corregir" }); }} className="rounded-xl border border-destructive px-4 py-2.5 text-sm font-extrabold text-destructive disabled:opacity-50">Rechazar / solicitar cambios</button></div></article>)}
  </div>;
}
