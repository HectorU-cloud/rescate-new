import { findUserByUnionId, findUserByEmail, upsertUser } from "../queries/users";

/**
 * Inicia sesión con una cuenta de Google ya verificada, SIN crear cuentas duplicadas.
 *
 * - Si ese correo ya tiene cuenta (por correo y contraseña o de un acceso anterior), se usa esa misma
 *   cuenta: Google comprobó que el correo es de esta persona.
 * - Si la cuenta existente se creó con contraseña pero nunca se verificó, pudo haberla creado un
 *   tercero que conoce ese correo (“pre-secuestro”). Se borra esa contraseña: quien controla el
 *   correo, que es quien acaba de entrar con Google, queda como dueño.
 */
export async function linkGoogleUser(profile: { sub: string; email: string; name: string; picture: string | null }) {
  const email = profile.email.trim().toLowerCase();
  const existing = await findUserByEmail(email);
  const unionId = existing?.unionId ?? `google:${profile.sub}`;
  const untrustedPassword = !!existing && !existing.emailVerifiedAt && !!existing.passwordHash;

  await upsertUser({
    unionId,
    name: profile.name,
    email,
    avatar: profile.picture,
    emailVerifiedAt: existing?.emailVerifiedAt ?? new Date(),
    lastSignInAt: new Date(),
    ...(untrustedPassword ? { passwordHash: null } : {}),
  });
  const user = await findUserByUnionId(unionId);
  if (!user) throw new Error("No se pudo crear la cuenta");
  return user;
}
