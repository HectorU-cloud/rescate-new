import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { findNewIds } from "@/lib/new-orders";
import { playNewOrderBeep, unlockAudio } from "@/lib/alert-sound";

const REPEAT_MS = 30_000;

/**
 * Alerta de pedidos nuevos para el comercio:
 *  - al llegar uno nuevo: aviso en pantalla + sonido;
 *  - mientras haya pedidos sin aceptar: el sonido se repite cada 30 s y la pestaña muestra el conteo.
 * `pendingIds` debe ser `null` mientras la consulta no haya cargado.
 */
export function useNewOrderAlert(pendingIds: number[] | null, soundOn: boolean) {
  const seen = useRef<Set<number> | null>(null);
  const count = pendingIds?.length ?? 0;
  const idsKey = pendingIds?.join(",") ?? null;

  // El primer toque en la pantalla habilita el audio del navegador.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Pedidos nuevos desde la consulta anterior.
  useEffect(() => {
    if (pendingIds === null) return;
    const fresh = findNewIds(seen.current, pendingIds);
    seen.current = new Set(pendingIds);
    if (fresh.length > 0) {
      toast.success(fresh.length === 1 ? "🧾 ¡Nuevo pedido!" : `🧾 ¡${fresh.length} pedidos nuevos!`);
      if (soundOn) playNewOrderBeep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Recordatorio sonoro mientras haya pedidos sin atender.
  useEffect(() => {
    if (!soundOn || count === 0) return;
    const timer = setInterval(playNewOrderBeep, REPEAT_MS);
    return () => clearInterval(timer);
  }, [soundOn, count]);

  // Conteo en el título de la pestaña.
  useEffect(() => {
    if (count === 0) return;
    const original = document.title;
    document.title = `(${count}) Pedido${count > 1 ? "s" : ""} nuevo${count > 1 ? "s" : ""} · ${original}`;
    return () => { document.title = original; };
  }, [count]);
}
