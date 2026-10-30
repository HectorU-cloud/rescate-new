import { IMAGE_RULES } from "@contracts/constants";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/** Reduce y comprime la foto a WebP en el navegador (los comprobantes se leen bien con 1600 px). */
export async function compressToWebp(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  if (!ACCEPTED.includes(file.type)) throw new Error("Usa una imagen JPG, PNG o WebP.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo procesar la fotografía.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo comprimir la imagen."))), "image/webp", quality),
    );
    if (blob.size > IMAGE_RULES.maxBytes) throw new Error(`La foto es muy pesada (máximo ${IMAGE_RULES.maxBytes / (1024 * 1024)} MB). Prueba con otra.`);
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Sube el archivo con un PUT directo a la URL prefirmada (el servidor nunca toca la imagen). */
export async function putToSignedUrl(uploadUrl: string, blob: Blob): Promise<void> {
  const response = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/webp" }, body: blob });
  if (!response.ok) throw new Error("Falló la subida de la foto. Inténtalo de nuevo.");
}
