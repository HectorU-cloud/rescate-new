/** Lo mínimo que necesitamos del contexto de Hono (permite probarlo sin levantar el servidor). */
export type IpContext = { req: { header(name: string): string | undefined }; env?: unknown };

const normalize = (ip: string) => ip.replace(/^::ffff:/i, "");

/**
 * IP real del cliente.
 *
 * `hops` = cuántos proxies de confianza hay delante del servidor (0 = ninguno, la app recibe
 * conexiones directas). Cada proxy AGREGA al final de X-Forwarded-For la IP que vio, por eso la IP
 * del cliente es la entrada `hops` posiciones desde el final y no la primera, que puede escribir
 * cualquiera. Con hops = 0 se ignora esa cabecera y se usa la IP de la conexión.
 */
export function clientIp(c: IpContext, hops: number): string {
  if (hops > 0) {
    const parts = (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const candidate = parts[parts.length - hops];
    if (candidate) return normalize(candidate);
  }
  const socketIp = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  return normalize(socketIp ?? "unknown");
}
