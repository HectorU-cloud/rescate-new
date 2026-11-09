import type { TourRole } from "@/lib/tour-steps";

/**
 * Recuerda, en ESTE dispositivo, qué guías de bienvenida ya se vieron.
 * Súbele el número a TOUR_VERSION cuando quieras que todos vuelvan a ver la guía (p. ej. tras un cambio grande).
 */
export const TOUR_VERSION = 1;
export const tourKey = (role: TourRole) => `rescate-tour-v${TOUR_VERSION}-${role}`;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // acceso al almacenamiento bloqueado
  }
}

// Si no hay almacenamiento (modo privado, bloqueado), se recuerda mientras dure la sesión: así la guía no reaparece en cada pantalla.
const seenThisSession = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function hasSeenTour(role: TourRole, storage: StorageLike | null = defaultStorage()): boolean {
  if (seenThisSession.has(tourKey(role))) return true;
  try {
    return storage?.getItem(tourKey(role)) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(role: TourRole, storage: StorageLike | null = defaultStorage()) {
  seenThisSession.add(tourKey(role));
  try {
    storage?.setItem(tourKey(role), "1");
  } catch {
    /* sin almacenamiento: queda solo en esta sesión */
  }
  notify();
}

/** Vuelve a dejar la guía como "no vista" (la usa el botón "Ver la guía otra vez" del Perfil). */
export function resetTour(role: TourRole, storage: StorageLike | null = defaultStorage()) {
  seenThisSession.delete(tourKey(role));
  try {
    storage?.removeItem(tourKey(role));
  } catch {
    /* ignorar */
  }
  notify();
}

/** Para `useSyncExternalStore`: avisa cuando cambia el estado aquí o en otra pestaña. */
export function subscribeTour(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith("rescate-tour-")) listener(); };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
