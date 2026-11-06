import { IMAGE_RULES } from "@contracts/constants";

// Fotos de productos, packs y del local: se optimizan en el navegador y se suben directo al almacenamiento
// con una URL prefirmada (el servidor nunca recibe la imagen).

export async function compressProductImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona un archivo de imagen.");
  if (file.size > 10 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 10 MB.");
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo leer la imagen."));
      img.src = source;
    });
    const scale = Math.min(1, 900 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo procesar la imagen.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL("image/jpeg", 0.68);
    if (result.length > 450_000) result = canvas.toDataURL("image/jpeg", 0.48);
    if (result.length > 500_000) throw new Error("La imagen sigue siendo muy pesada. Prueba con otra foto.");
    return result;
  } finally {
    URL.revokeObjectURL(source);
  }
}

export type ImageUploadInput = {
  contentType: "image/jpeg";
  kind: "product" | "rescue-pack" | "business-logo";
  size: number;
};
type ImageUploadResult = { uploadUrl: string; imageUrl: string };

export async function uploadCompressedImage(
  dataUrl: string,
  kind: ImageUploadInput["kind"],
  createUpload: (input: ImageUploadInput) => Promise<ImageUploadResult>,
): Promise<string> {
  const blob = await fetch(dataUrl).then((response) => response.blob());
  if (blob.type !== "image/jpeg") throw new Error("La imagen optimizada no tiene un formato válido.");
  if (blob.size > IMAGE_RULES.maxBytes) throw new Error("La imagen es muy pesada (máximo 2 MB). Prueba con otra foto.");
  const target = await createUpload({ contentType: "image/jpeg", kind, size: blob.size });
  const response = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
  if (!response.ok) throw new Error("No se pudo guardar la imagen en el almacenamiento. Revisa el bucket y su configuración CORS.");
  return target.imageUrl;
}
