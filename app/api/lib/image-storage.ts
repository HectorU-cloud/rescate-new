import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { env } from "./env";

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type SupportedImageMime = keyof typeof MIME_EXTENSIONS;

let client: S3Client | undefined;

export function imageStorageConfigured() {
  return Boolean(
    env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey && env.s3PublicUrl,
  );
}

function getClient() {
  if (!imageStorageConfigured()) return null;
  if (!client) {
    client = new S3Client({
      region: env.s3Region,
      ...(env.s3Endpoint ? { endpoint: env.s3Endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
  }
  return client;
}

export async function createImageUploadUrl(args: {
  businessId: number;
  contentType: SupportedImageMime;
  kind: "product" | "rescue-pack";
}) {
  const s3 = getClient();
  if (!s3) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El almacenamiento de imágenes no está configurado. Revisa S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY y S3_PUBLIC_URL.",
    });
  }

  const extension = MIME_EXTENSIONS[args.contentType];
  const key = `businesses/${args.businessId}/${args.kind}/${nanoid(24)}.${extension}`;
  const command = new PutObjectCommand({
    Bucket: env.s3Bucket,
    Key: key,
    ContentType: args.contentType,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  const imageUrl = `${env.s3PublicUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return { uploadUrl, imageUrl, key, contentType: args.contentType };
}
