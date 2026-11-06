import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";

/**
 * Puerta de entrada: sin sesión iniciada no se muestra nada de la app, se lleva a /login.
 * Mientras se comprueba la sesión se muestra una pantalla de carga (así no parpadea el contenido).
 * Las páginas públicas (login, privacidad, términos, eliminar cuenta) quedan fuera de esta puerta.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return (
      <main className="grid min-h-[100svh] place-items-center" style={{ background: "#fbf8f0" }} aria-busy="true">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-border border-t-brand" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-muted-foreground">Cargando…</p>
        </div>
      </main>
    );
  }
  if (!isAuthenticated) return <Navigate to={LOGIN_PATH} replace />;
  return <>{children}</>;
}
