import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const ctx = (headers: Record<string, string>, remoteAddress?: string) => ({
  req: { header: (name: string) => headers[name.toLowerCase()] },
  env: remoteAddress ? { incoming: { socket: { remoteAddress } } } : undefined,
});

describe("clientIp", () => {
  it("sin proxies (hops = 0) ignora X-Forwarded-For y usa la IP de la conexión", () => {
    expect(clientIp(ctx({ "x-forwarded-for": "9.9.9.9" }, "203.0.113.7"), 0)).toBe("203.0.113.7");
  });
  it("con un proxy usa la ÚLTIMA entrada (la que agregó el proxy), no la primera que escribe el cliente", () => {
    // el atacante manda "6.6.6.6"; el proxy agrega la IP real que vio
    expect(clientIp(ctx({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }, "10.0.0.1"), 1)).toBe("198.51.100.4");
  });
  it("cambiar el valor falso que manda el cliente NO cambia la IP detectada", () => {
    const real = "198.51.100.4";
    const a = clientIp(ctx({ "x-forwarded-for": `1.1.1.1, ${real}` }), 1);
    const b = clientIp(ctx({ "x-forwarded-for": `2.2.2.2, ${real}` }), 1);
    const c = clientIp(ctx({ "x-forwarded-for": `3.3.3.3, 4.4.4.4, ${real}` }), 1);
    expect([a, b, c]).toEqual([real, real, real]);
  });
  it("con dos proxies (p. ej. CDN + plataforma) toma la penúltima", () => {
    expect(clientIp(ctx({ "x-forwarded-for": "6.6.6.6, 198.51.100.4, 172.16.0.9" }), 2)).toBe("198.51.100.4");
  });
  it("si hay menos entradas que proxies (llegó sin pasar por el proxy) usa la IP de la conexión", () => {
    expect(clientIp(ctx({}, "203.0.113.7"), 1)).toBe("203.0.113.7");
    expect(clientIp(ctx({ "x-forwarded-for": "6.6.6.6" }, "203.0.113.7"), 2)).toBe("203.0.113.7");
  });
  it("normaliza IPv4 escrita como IPv6 y devuelve 'unknown' si no hay datos", () => {
    expect(clientIp(ctx({}, "::ffff:203.0.113.7"), 0)).toBe("203.0.113.7");
    expect(clientIp(ctx({}), 0)).toBe("unknown");
  });
  it("ignora espacios y entradas vacías", () => {
    expect(clientIp(ctx({ "x-forwarded-for": " 6.6.6.6 ,, 198.51.100.4 " }), 1)).toBe("198.51.100.4");
  });
});
