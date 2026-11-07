import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { cityById, detectCity } from "@contracts/cities";
import { trpc } from "@/providers/trpc";
import { GeoError, getPosition } from "@/lib/geolocate";
import type { CityController, DetectOutcome } from "@/hooks/useCity";

/**
 * Ciudad donde trabaja el repartidor. A diferencia de la ciudad de navegación del cliente (que se recuerda en el
 * dispositivo), esta se guarda en el SERVIDOR: es lo que decide qué pedidos ve y a qué avisos push le llegan.
 * Solo se guarda el id de la ciudad, nunca la ubicación.
 */
export function useCourierCity(enabled: boolean): CityController {
  const utils = trpc.useUtils();
  const query = trpc.courier.myCity.useQuery(undefined, { enabled, staleTime: 60_000 });
  const { mutate } = trpc.courier.setCity.useMutation({
    onSuccess: () => {
      void utils.courier.myCity.invalidate();
      void utils.courier.available.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cityId = query.data?.cityId ?? null;

  // Un repartidor no puede elegir "todas las ciudades": siempre trabaja en una.
  const setCity = useCallback(
    (id: string | null) => {
      if (id && id !== cityId) mutate({ cityId: id });
    },
    [cityId, mutate],
  );

  const detect = useCallback(async (): Promise<DetectOutcome> => {
    try {
      const { lat, lng } = await getPosition();
      const found = detectCity(lat, lng);
      if (found.city) {
        if (found.city.id !== cityId) mutate({ cityId: found.city.id });
        return { status: "ok", city: found.city };
      }
      return { status: "outside", nearest: found.nearest, distanceKm: found.distanceKm };
    } catch (e) {
      return { status: e instanceof GeoError ? e.reason : "unavailable" };
    }
  }, [cityId, mutate]);

  return useMemo<CityController>(
    () => ({
      city: cityById(cityId),
      // Mientras carga (o si falla) no se le pregunta: solo cuando se sabe que aún no eligió.
      hasChosen: query.isSuccess ? cityId !== null : true,
      source: null,
      setCity,
      detect,
    }),
    [cityId, query.isSuccess, setCity, detect],
  );
}
