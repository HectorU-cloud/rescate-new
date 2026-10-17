import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

const isProduction = process.env.NODE_ENV === "production";

// Cuántos proxies de confianza hay delante de la app (para saber la IP real de cada cliente).
// Por defecto 1 en producción (Render, Railway, Fly… ponen uno) y 0 en local.
const rawHops = process.env.TRUSTED_PROXY_HOPS;
const trustedProxyHops = rawHops !== undefined && rawHops !== "" ? Math.max(0, Number.parseInt(rawHops, 10) || 0) : isProduction ? 1 : 0;

export const env = {
  appSecret: required("APP_SECRET"),
  isProduction,
  databaseUrl: required("DATABASE_URL"),
  // Login con Google (https://console.cloud.google.com/apis/credentials)
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  // URL pública de la app (sin "/" final). Si está vacío se deduce de la petición.
  appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
  // Quien entre con este correo (verificado por Google) recibe role "admin"
  ownerEmail: (process.env.OWNER_EMAIL ?? "").trim().toLowerCase(),
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
  // Login falso solo para desarrollo. Nunca activo en producción.
  devLogin: process.env.DEV_LOGIN === "true" && !isProduction,
  trustedProxyHops,
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  authEmailFrom: process.env.AUTH_EMAIL_FROM ?? "Al Rescate <noreply@example.com>",
  // Almacenamiento compatible con S3 (AWS S3 o Cloudflare R2).
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION || "auto",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  s3PublicUrl: (process.env.S3_PUBLIC_URL ?? "").replace(/\/$/, ""),
};

if (!env.appSecret || (isProduction && env.appSecret.length < 32)) {
  throw new Error(
    "APP_SECRET es obligatorio (en producción, mínimo 32 caracteres).",
  );
}

if (isProduction && !env.resendApiKey) {
  console.warn("[auth] RESEND_API_KEY no está configurado: el registro y la recuperación de contraseña por correo no enviarán mensajes.");
}
if (isProduction && env.resendApiKey && /@example\.com>?\s*$/.test(env.authEmailFrom)) {
  console.warn("[auth] AUTH_EMAIL_FROM sigue con el valor de ejemplo: Resend rechazará los correos. Usa un remitente de tu dominio verificado.");
}
