import { Navigate } from "react-router";
import { ShieldCheck, CheckCircle2, XCircle, Bike } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { toast } from "sonner";

export default function AdminCouriers() {
  const { user, isAuthenticated } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const couriers = trpc.profile.adminCouriers.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin", retry: false });
  const setApproval = trpc.profile.setCourierApproval.useMutation({
    onSuccess: async () => { await couriers.refetch(); toast.success("Estado del repartidor actualizado"); },
    onError: (error) => toast.error(error.message),
  });

  if (!isAuthenticated || !user) return null;
  if (user.role !== "admin") return <Navigate to="/" replace />;

  return <div className="mx-auto max-w-3xl space-y-5">
    <header className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
      <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-dark"><ShieldCheck className="h-6 w-6" /></span><div><h1 className="font-display text-2xl font-extrabold">Administración</h1><p className="text-sm text-muted-foreground">Revisión manual de repartidores</p></div></div>
      <p className="mt-3 text-sm text-muted-foreground">Aprueba solo después de revisar los datos del repartidor fuera de la app. El distintivo no representa una verificación oficial automática.</p>
    </header>
    {couriers.isLoading && <p className="p-4 text-sm text-muted-foreground">Cargando repartidores…</p>}
    {couriers.error && <div className="rounded-2xl bg-card p-4 text-sm text-destructive ring-1 ring-border">No se pudo cargar la lista: {couriers.error.message}</div>}
    {!couriers.isLoading && !couriers.error && (couriers.data?.length ?? 0) === 0 && <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground ring-1 ring-border">Todavía no hay cuentas en modo repartidor.</div>}
    <div className="space-y-3">{couriers.data?.map((courier) => <article key={courier.id} className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
      <div className="flex items-start gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-secondary">{courier.courierPhotoUrl ? <img src={courier.courierPhotoUrl} alt="Foto del repartidor" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Bike className="h-6 w-6" /></div>}</div>
        <div className="min-w-0 flex-1"><h2 className="font-extrabold">{courier.name || "Sin nombre"}</h2><p className="break-all text-sm text-muted-foreground">{courier.email}</p><p className="mt-1 text-sm">{courier.courierVehicle || "Vehículo sin indicar"}{courier.courierPlate ? ` · ${courier.courierPlate}` : ""}</p>{courier.courierBio && <p className="mt-2 text-sm text-muted-foreground">{courier.courierBio}</p>}</div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-extrabold ${courier.courierApproved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{courier.courierApproved ? "Aprobado" : "Pendiente"}</span>
      </div>
      <div className="mt-4 flex gap-2">{!courier.courierApproved ? <button onClick={() => setApproval.mutate({ userId: courier.id, approved: true })} disabled={setApproval.isPending} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-extrabold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Aprobar</button> : <button onClick={() => setApproval.mutate({ userId: courier.id, approved: false })} disabled={setApproval.isPending} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-bold disabled:opacity-50"><XCircle className="h-4 w-4" /> Retirar aprobación</button>}</div>
    </article>)}</div>
  </div>;
}
