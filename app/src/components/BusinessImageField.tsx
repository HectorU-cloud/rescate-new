import { useRef, useState } from "react";
import { toast } from "sonner";
import { compressProductImage } from "@/lib/product-image";

/**
 * Selector de la foto o logo del local. Solo elige y optimiza la imagen (JPEG en el navegador);
 * quien lo usa decide cuándo subirla. `previewUrl` es lo que se muestra ahora (foto guardada o recién elegida).
 */
export default function BusinessImageField({
  previewUrl,
  emoji,
  busy = false,
  onSelect,
  onRemove,
}: {
  previewUrl: string | null;
  emoji: string;
  busy?: boolean;
  /** Imagen optimizada como data URL JPEG, lista para subir. */
  onSelect: (dataUrl: string) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const disabled = busy || processing;

  async function choose(file: File | undefined) {
    if (!file) return;
    setProcessing(true);
    try {
      await onSelect(await compressProductImage(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar la foto");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-extrabold text-muted-foreground">Foto o logo del local (opcional)</p>
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-input p-3">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-secondary text-4xl">
          {previewUrl ? <img src={previewUrl} alt="Vista previa del local" className="h-full w-full object-cover" /> : <span aria-hidden="true">{emoji || "🍽️"}</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label="Elegir foto o logo del local"
            disabled={disabled}
            onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; void choose(file); }}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="rounded-xl bg-secondary px-3 py-2 text-xs font-extrabold disabled:opacity-50">
              {processing || busy ? "Procesando…" : previewUrl ? "Cambiar foto" : "Subir foto o logo"}
            </button>
            {previewUrl && (
              <button type="button" disabled={disabled} onClick={() => void Promise.resolve(onRemove()).catch(() => undefined)} className="rounded-xl px-3 py-2 text-xs font-extrabold text-destructive disabled:opacity-50">
                Quitar
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">JPG, PNG o WebP. Se muestra recortada al centro: una imagen cuadrada o apaisada se ve mejor. Si no subes nada, se usa el emoji.</p>
        </div>
      </div>
    </div>
  );
}
