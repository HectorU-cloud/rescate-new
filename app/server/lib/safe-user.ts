import type { User } from "@db/schema";

/**
 * Lo que el navegador recibe de su propia cuenta (`auth.me`).
 * Nunca incluye el hash de la contraseña, la versión de sesión ni el identificador interno de acceso.
 */
export type SafeUser = Omit<User, "passwordHash" | "sessionVersion" | "unionId">;

const HIDDEN = ["passwordHash", "sessionVersion", "unionId"] as const;

export function toSafeUser(user: User): SafeUser {
  const safe: Partial<User> = { ...user };
  for (const key of HIDDEN) delete safe[key];
  return safe as SafeUser;
}
