import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { cityById, detectCity, type City } from "@contracts/cities";
import { CITY_STORAGE_KEY, parseCityChoice, serializeCityChoice, type CityChoice, type CitySource } from "@/lib/city-storage";
import { GeoError, getPosition, type GeoFailure } from "@/lib/geolocate";

/** Resultado de intentar ubicar a la persona con el GPS. */
export type DetectOutcome =
  | { status: "ok"; city: City }
  /** Está fuera de nuestras ciudades; `nearest` es la más cercana. */
  | { status: "outside"; nearest: City; distanceKm: number }
  | { status: GeoFailure };

export type CityController = {
  /** La ciudad elegida, o null si se eligió "todas" o todavía no se eligió. */
  city: City | null;
  /** ¿La persona ya decidió (elegir una ciudad, "todas" o saltar la pregunta)? Si no, hay que preguntarle. */
  hasChosen: boolean;
  source: CitySource | null;
  /** Fija la ciudad (`null` = todas las ciudades) y la recuerda en este dispositivo. */
  setCity: (cityId: string | null, source: CitySource) => void;
  /** Pide la ubicación y, si cae en una de nuestras ciudades, la fija. La ubicación no se envía ni se guarda. */
  detect: () => Promise<DetectOutcome>;
};

const CityContext = createContext<CityController | null>(null);

function readStored(): CityChoice | null {
  try {
    return parseCityChoice(localStorage.getItem(CITY_STORAGE_KEY));
  } catch {
    return null; // almacenamiento bloqueado (modo privado, etc.): se pregunta en cada visita y listo
  }
}

export function CityProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<CityChoice | null>(readStored);

  // Si cambian la ciudad en otra pestaña, esta se entera.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === CITY_STORAGE_KEY) setChoice(parseCityChoice(e.newValue)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setCity = useCallback((cityId: string | null, source: CitySource) => {
    if (cityId !== null && !cityById(cityId)) return; // ciudad desconocida: se ignora
    const next: CityChoice = { cityId, source };
    setChoice(next);
    try {
      localStorage.setItem(CITY_STORAGE_KEY, serializeCityChoice(next));
    } catch {
      /* sin almacenamiento: la elección vale durante esta sesión */
    }
  }, []);

  const detect = useCallback(async (): Promise<DetectOutcome> => {
    try {
      const { lat, lng } = await getPosition();
      const found = detectCity(lat, lng);
      if (found.city) {
        setCity(found.city.id, "gps");
        return { status: "ok", city: found.city };
      }
      return { status: "outside", nearest: found.nearest, distanceKm: found.distanceKm };
    } catch (e) {
      return { status: e instanceof GeoError ? e.reason : "unavailable" };
    }
  }, [setCity]);

  const value = useMemo<CityController>(
    () => ({ city: cityById(choice?.cityId), hasChosen: choice !== null, source: choice?.source ?? null, setCity, detect }),
    [choice, setCity, detect],
  );
  return <CityContext.Provider value={value}>{children}</CityContext.Provider>;
}

export function useCity(): CityController {
  const ctx = useContext(CityContext);
  if (!ctx) throw new Error("useCity debe usarse dentro de <CityProvider>");
  return ctx;
}
