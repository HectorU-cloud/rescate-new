// Reglas puras de las imágenes subidas (sin configuración ni base de datos: fáciles de probar).
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type SupportedImageMime = keyof typeof MIME_EXTENSIONS;

/** Cliente de almacenamiento compatible con S3 (AWS S3 o Cloudflare R2). */
export function createStorageClient(cfg: { region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string }) {
  return new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Sin esto, las versiones recientes del SDK agregan a la URL firmada un checksum CRC32 calculado sobre
    // un cuerpo VACÍO (x-amz-checksum-crc32); al subir el archivo real el checksum no coincide y R2 puede
    // rechazar la subida. Cloudflare recomienda "WHEN_REQUIRED" para el SDK de JavaScript.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/**
 * Firma la URL de subida atando al firmado el tipo y el TAMAÑO exactos del archivo.
 * Sin `signableHeaders` el SDK solo firma el host: cualquiera con la URL podría subir cualquier tipo
 * de archivo, de cualquier peso. Con esto, R2 rechaza la subida si el tipo o el tamaño no coinciden.
 */
export async function presignImageUpload(
  s3: S3Client,
  args: { bucket: string; key: string; contentType: SupportedImageMime; size: number; expiresIn?: number; signingDate?: Date },
) {
  const command = new PutObjectCommand({
    Bucket: args.bucket,
    Key: args.key,
    ContentType: args.contentType,
    ContentLength: args.size,
  });
  return getSignedUrl(s3, command, {
    expiresIn: args.expiresIn ?? 300,
    signableHeaders: new Set(["content-type", "content-length"]),
    ...(args.signingDate ? { signingDate: args.signingDate } : {}),
  });
}

const FILE_NAME = /^[A-Za-z0-9_-]{10,40}\.(jpg|png|webp)$/;

/**
 * Si `url` apunta a una imagen de NUESTRO almacenamiento dentro de `folder`
 * (p. ej. "businesses/12/product"), devuelve la clave del objeto; si no, null.
 * Estricta: sin subcarpetas, sin "..", sin parámetros ni fragmentos y con el formato de nombre que generamos.
 */
export function keyFromOwnedUrl(publicUrl: string, url: string, folder: string): string | null {
  if (!publicUrl || !url || url.length > 1000) return null;
  const prefix = `${publicUrl}/${folder}/`;
  if (!url.startsWith(prefix)) return null;
  const file = url.slice(prefix.length);
  if (/[?#\\/]/.test(file)) return null; // sin subcarpetas ni parámetros
  let decoded: string;
  try { decoded = decodeURIComponent(file); } catch { return null; }
  if (!FILE_NAME.test(decoded)) return null;
  return `${folder}/${decoded}`;
}
