import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

const isProduction = process.env.NODE_ENV === "production";

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
};

if (!env.appSecret || (isProduction && env.appSecret.length < 32)) {
  throw new Error(
    "APP_SECRET es obligatorio (en producción, mínimo 32 caracteres).",
  );
}
