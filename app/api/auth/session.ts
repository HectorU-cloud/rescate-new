import * as jose from "jose";
import { env } from "../lib/env";

const JWT_ALG = "HS256";

// sv = versión de sesión del usuario: al subir (cambio de contraseña, "cerrar todas las sesiones") las anteriores dejan de valer
export type SessionPayload = { unionId: string; sv?: number };

export async function signSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("1 year")
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const { unionId, sv } = payload;
    if (typeof unionId !== "string" || !unionId) return null;
    return { unionId, sv: typeof sv === "number" ? sv : 0 }; // sesiones anteriores a este cambio no traen sv
  } catch {
    return null;
  }
}
