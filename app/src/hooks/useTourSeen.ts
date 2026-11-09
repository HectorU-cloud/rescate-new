import { useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { TourRole } from "@/lib/tour-steps";
import { hasSeenTour, subscribeTour } from "@/lib/tour-state";

/** ¿Ya vio esta persona (en este dispositivo) la guía de bienvenida de ese rol? Se actualiza sola al terminarla o repetirla. */
export function useTourSeen(role: TourRole): boolean {
  return useSyncExternalStore(subscribeTour, () => hasSeenTour(role), () => true);
}

/**
 * ¿Le toca ver ahora la guía de ese rol? Solo si su rol en la app coincide (un dueño de local que pasa por Inicio
 * no ve la guía de clientes) y aún no la vio. Lo usan la propia guía y el selector de ciudad, que espera a que termine.
 */
export function useTourPending(role: TourRole): boolean {
  const { user } = useAuth();
  const seen = useTourSeen(role);
  return user?.appRole === role && !seen;
}
