import { describe, expect, it } from "vitest";
import { buildEnvelope, createThrottle, parseDsn, scrub } from "@contracts/monitoring";

describe("parseDsn", () => {
  it("arma la URL del endpoint con la clave pública", () => {
    const t = parseDsn("https://abc123@o42.ingest.sentry.io/777");
    expect(t?.url).toBe("https://o42.ingest.sentry.io/api/777/envelope/?sentry_version=7&sentry_key=abc123&sentry_client=rescate-lite%2F1.0");
  });
  it("rechaza vacío o inválido", () => {
    for (const bad of [undefined, "", "no-es-url", "https://o42.ingest.sentry.io/777", "https://k@host/abc"]) expect(parseDsn(bad)).toBeNull();
  });
});

describe("buildEnvelope", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  it("genera 3 líneas JSON válidas y tapa correos", () => {
    const lines = buildEnvelope({ error: new Error("falló para ana@correo.com"), platform: "node", environment: "production", tags: { path: "orders.create", skip: undefined }, userId: 5 }, now, "e".repeat(32)).split("\n");
    expect(lines).toHaveLength(3);
    const [header, item, event] = lines.map((l) => JSON.parse(l));
    expect(header.event_id).toBe("e".repeat(32));
    expect(item).toEqual({ type: "event" });
    expect(event.exception.values[0]).toEqual({ type: "Error", value: "falló para [correo]" });
    expect(event.tags).toEqual({ path: "orders.create" });
    expect(event.user).toEqual({ id: "5" });
    expect(event.timestamp).toBe(now.getTime() / 1000);
  });
  it("acepta valores que no son Error", () => {
    const event = JSON.parse(buildEnvelope({ error: { a: 1 }, platform: "javascript", environment: "x" }, now).split("\n")[2]);
    expect(event.exception.values[0].value).toBe('{"a":1}');
  });
});

describe("createThrottle", () => {
  it("deja pasar un mismo mensaje una vez por minuto y respeta el máximo", () => {
    const allow = createThrottle(2, 60_000);
    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 1_000)).toBe(false);
    expect(allow("b", 2_000)).toBe(true);
    expect(allow("c", 3_000)).toBe(false); // tope de 2 por minuto
    expect(allow("c", 61_000)).toBe(true); // ventana nueva
  });
});

describe("scrub", () => {
  it("recorta textos largos", () => expect(scrub("x".repeat(5000), 100)).toHaveLength(100));
});
