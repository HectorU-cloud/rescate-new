/** Datos de la entidad responsable. Se configuran en Vercel (VITE_*) y se leen al compilar. */
export const LEGAL = {
  name: (import.meta.env.VITE_LEGAL_NAME as string | undefined)?.trim() || "Al Rescate",
  email: (import.meta.env.VITE_PRIVACY_EMAIL as string | undefined)?.trim() || "",
  updated: "25 de octubre de 2026",
};
