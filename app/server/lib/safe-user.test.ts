import { describe, expect, it } from "vitest";
import { toSafeUser } from "./safe-user";
import type { User } from "@db/schema";

const user = {
  id: 7, unionId: "email:ana@example.com", name: "Ana", email: "ana@example.com",
  passwordHash: "scrypt:salt:hash", emailVerifiedAt: new Date(0), sessionVersion: 3,
  role: "user", appRole: "customer", phone: "0991234567",
} as unknown as User;

describe("toSafeUser", () => {
  it("quita hash de contraseña, versión de sesión e identificador interno", () => {
    const out = toSafeUser(user) as Record<string, unknown>;
    for (const k of ["passwordHash", "sessionVersion", "unionId"]) expect(k in out).toBe(false);
  });
  it("conserva lo que la app necesita para mostrar la cuenta", () => {
    const out = toSafeUser(user);
    expect([out.id, out.name, out.email, out.role, out.appRole, out.phone]).toEqual([7, "Ana", "ana@example.com", "user", "customer", "0991234567"]);
  });
  it("no modifica el objeto original", () => {
    toSafeUser(user);
    expect(user.passwordHash).toBe("scrypt:salt:hash");
    expect(user.sessionVersion).toBe(3);
  });
});
