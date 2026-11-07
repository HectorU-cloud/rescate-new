/** Por qué no se pudo obtener la ubicación. */
export type GeoFailure = "denied" | "unavailable" | "timeout" | "unsupported";

export class GeoError extends Error {
  reason: GeoFailure;
  constructor(reason: GeoFailure) {
    super(reason);
    this.reason = reason;
  }
}

/** Traduce el código de error del navegador (1 = permiso denegado, 2 = no disponible, 3 = tiempo agotado). */
export function geoFailureFromCode(code: number): GeoFailure {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

/** Texto para la persona. Nunca culpa al usuario ni da instrucciones técnicas. */
export const GEO_FAILURE_MESSAGES: Record<GeoFailure, string> = {
  denied: "No pudimos usar tu ubicación porque el permiso está bloqueado. Puedes elegir tu ciudad aquí abajo.",
  unavailable: "No pudimos saber dónde estás en este momento. Elige tu ciudad aquí abajo.",
  timeout: "La ubicación tardó demasiado en responder. Inténtalo de nuevo o elige tu ciudad aquí abajo.",
  unsupported: "Este dispositivo o navegador no permite usar la ubicación. Elige tu ciudad aquí abajo.",
};

/**
 * Pide la ubicación UNA vez. Con precisión baja y caché corta: para saber la ciudad no hace falta el GPS fino
 * (ahorra batería y es más rápido). Nada se envía ni se guarda: solo se devuelve a quien llama.
 */
export function getPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || !window.isSecureContext) {
      reject(new GeoError("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new GeoError(geoFailureFromCode(err.code))),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  });
}
