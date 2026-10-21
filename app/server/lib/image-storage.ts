import { CopyObjectCommand, DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { IMAGE_RULES } from "@contracts/constants";
import { env } from "./env";
import { consume } from "./rate-bucket";
import { MIME_EXTENSIONS, createStorageClient, keyFromOwnedUrl, presignImageUpload, type SupportedImageMime } from "./image-rules";

export type { SupportedImageMime } from "./image-rules";

let client: S3Client | undefined;

export function imageStorageConfigured() {
  return Boolean(
    env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey && env.s3PublicUrl,
  );
}

function getClient() {
  if (!imageStorageConfigured()) return null;
  if (!client) {
    client = createStorageClient({
      region: env.s3Region,
      endpoint: env.s3Endpoint || undefined,
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey,
    });
  }
  return client;
}

/** Carpetas donde cada dueño puede subir y desde donde puede usar imágenes. */
export const businessImageFolder = (businessId: number, kind: "product" | "rescue-pack") => `businesses/${businessId}/${kind}`;
export const courierPhotoFolder = (userId: number) => `couriers/${userId}/profile`;

export async function createImageUploadUrl(args: {
  businessId?: number;
  contentType: SupportedImageMime;
  /** Tamaño exacto en bytes del archivo que se va a subir. Queda atado a la firma. */
  size: number;
  kind: "product" | "rescue-pack" | "courier-profile";
  ownerId?: number;
  /** Quién pide la subida (para limitar cuántas puede pedir por hora). */
  userId: number;
}) {
  const s3 = getClient();
  if (!s3) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El almacenamiento de imágenes no está configurado. Revisa S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY y S3_PUBLIC_URL.",
    });
  }
  if (!Number.isInteger(args.size) || args.size < 1 || args.size > IMAGE_RULES.maxBytes) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `La imagen es muy pesada (máximo ${IMAGE_RULES.maxBytes / (1024 * 1024)} MB). Prueba con otra foto.`,
    });
  }
  const limit = consume(`img:${args.userId}`, 60 * 60 * 1000, IMAGE_RULES.maxUploadsPerHour);
  if (!limit.allowed) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Subiste muchas fotos en poco tiempo. Inténtalo de nuevo más tarde." });
  }

  const folder = args.kind === "courier-profile"
    ? courierPhotoFolder(args.ownerId ?? args.userId)
    : businessImageFolder(args.businessId ?? 0, args.kind);
  // Todas las subidas empiezan en staging/: R2 puede borrar por ciclo de vida las no confirmadas.
  const key = `staging/${folder}/${nanoid(24)}.${MIME_EXTENSIONS[args.contentType]}`;
  const uploadUrl = await presignImageUpload(s3, { bucket: env.s3Bucket, key, contentType: args.contentType, size: args.size });
  const imageUrl = `${env.s3PublicUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return { uploadUrl, imageUrl, key, contentType: args.contentType };
}

/** Promueve una subida temporal a su carpeta permanente cuando la referencia se guarda en BD. */
export async function promoteStagedImageUrl(url: string | null | undefined, folder: string): Promise<string | null | undefined> {
  if (!url) return url;
  const prefix = `${env.s3PublicUrl}/staging/${folder}/`;
  if (!url.startsWith(prefix)) return url;
  const file = url.slice(prefix.length);
  if (/[?#\\/]/.test(file)) throw new TRPCError({ code: "BAD_REQUEST", message: "La imagen temporal no es válida." });
  let decoded: string;
  try { decoded = decodeURIComponent(file); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "La imagen temporal no es válida." }); }
  if (!/^[A-Za-z0-9_-]{10,40}\.(jpg|png|webp)$/.test(decoded)) throw new TRPCError({ code: "BAD_REQUEST", message: "La imagen temporal no es válida." });
  const s3 = getClient();
  if (!s3) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El almacenamiento de imágenes no está configurado." });
  const sourceKey = `staging/${folder}/${decoded}`;
  const destinationKey = `${folder}/${decoded}`;
  try {
    await s3.send(new CopyObjectCommand({ Bucket: env.s3Bucket, Key: destinationKey, CopySource: `${env.s3Bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}` }));
  } catch (e) {
    console.error("[images] no se pudo confirmar la subida temporal", sourceKey, e instanceof Error ? e.message : e);
    throw new TRPCError({ code: "BAD_REQUEST", message: "No se pudo confirmar la foto. Vuelve a subirla e inténtalo de nuevo." });
  }
  // Si falla el borrado, la regla de ciclo de vida de staging/ lo limpiará posteriormente.
  await s3.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: sourceKey })).catch((e) => {
    console.warn("[images] copia confirmada; limpieza temporal pendiente", sourceKey, e instanceof Error ? e.message : e);
  });
  return `${env.s3PublicUrl}/${destinationKey.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Valida la imagen que se quiere guardar: debe ser una que subió ESTE dueño a SU carpeta
 * (no una URL de terceros ni de otro comercio). Lo que ya estaba guardado se acepta tal cual,
 * así editar otros datos no rompe imágenes antiguas.
 */
export function assertValidImageUrl(url: string | null | undefined, folder: string, current?: string | null) {
  if (!url) return;
  if (current && url === current) return;
  if (!keyFromOwnedUrl(env.s3PublicUrl, url, folder)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "La imagen no es válida. Súbela desde la app (JPG, PNG o WebP)." });
  }
}

/** Borra del almacenamiento una imagen de `folder`. Nunca lanza error: es limpieza, no debe romper la operación. */
export async function deleteStoredImage(url: string, folder: string) {
  const key = keyFromOwnedUrl(env.s3PublicUrl, url, folder);
  const s3 = getClient();
  if (!key || !s3) return false;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return true;
  } catch (e) {
    console.error("[images] no se pudo borrar", key, e instanceof Error ? e.message : e);
    return false;
  }
}
