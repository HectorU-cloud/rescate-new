import { importPKCS8, SignJWT } from "jose";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { pushTokens } from "@db/schema";

const FIREBASE_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };
let cachedAccessToken: { value: string; expiresAt: number } | null = null;
let parsedAccount: ServiceAccount | null | undefined;

function serviceAccount(): ServiceAccount | null {
  if (parsedAccount !== undefined) return parsedAccount;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return (parsedAccount = null);
  try {
    const account = JSON.parse(raw) as ServiceAccount;
    if (!account.project_id || !account.client_email || !account.private_key) return (parsedAccount = null);
    return (parsedAccount = account);
  } catch {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON no contiene JSON válido.");
    return (parsedAccount = null);
  }
}

export function pushConfigured() {
  return !!serviceAccount();
}

async function getAccessToken(account: ServiceAccount) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.value;
  const key = await importPKCS8(account.private_key.replace(/\\n/g, "\n"), "RS256");
  const assertion = await new SignJWT({ scope: FIREBASE_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience(account.token_uri || "https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Firebase OAuth falló (${response.status})`);
  const data = await response.json() as { access_token: string; expires_in?: number };
  cachedAccessToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

export async function sendPushToUser(userId: number, notification: { title: string; body: string; url?: string; orderId?: number }) {
  const account = serviceAccount();
  if (!account) return { sent: 0, skipped: true };
  const db = getDb();
  const devices = await db.select().from(pushTokens).where(eq(pushTokens.userId, userId));
  if (!devices.length) return { sent: 0, skipped: false };
  const accessToken = await getAccessToken(account);
  let sent = 0;
  for (const device of devices) {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ message: {
        token: device.token,
        // Data-only avoids duplicate notifications: the service worker displays one notification.
        data: {
          title: notification.title,
          body: notification.body,
          url: notification.url ?? (notification.orderId ? `/pedido/${notification.orderId}` : "/pedidos"),
          ...(notification.orderId ? { orderId: String(notification.orderId) } : {}),
        },
        webpush: { headers: { Urgency: "high" } },
      } }),
    });
    if (response.ok) { sent += 1; continue; }
    const errorBody = await response.text().catch(() => "");
    if (response.status === 404 || errorBody.includes("UNREGISTERED") || errorBody.includes("registration-token-not-registered")) {
      await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, device.token)));
    } else {
      console.error(`No se pudo enviar push a usuario ${userId}: ${response.status} ${errorBody.slice(0, 300)}`);
    }
  }
  return { sent, skipped: false };
}

export async function notifyOrderStatus(args: { customerId: number; orderId: number; code: string; status: string; type: "delivery" | "rescue" }) {
  const details: Record<string, { title: string; body: string }> = {
    pending: { title: "Pedido recibido 🧾", body: `Recibimos tu pedido ${args.code}. Avisaremos cuando el local lo confirme.` },
    accepted: args.type === "rescue" ? { title: "Pack reservado 🧡", body: `Tu pack ${args.code} quedó reservado para retirar en el local.` } : { title: "Pedido confirmado ✅", body: `El local confirmó tu pedido ${args.code}.` },
    preparing: { title: "¡Están preparando tu pedido! 👨‍🍳", body: `El local ya está preparando el pedido ${args.code}.` },
    ready: { title: args.type === "rescue" ? "Tu pack está listo 🧡" : "Tu pedido está listo 🍽️", body: args.type === "rescue" ? `Tu pack ${args.code} está listo para retirar.` : `El pedido ${args.code} está listo para el repartidor.` },
    picked_up: { title: "¡Tu pedido va en camino! 🛵", body: `El repartidor recogió tu pedido ${args.code}.` },
    delivered: { title: "Pedido entregado 🎉", body: `El pedido ${args.code} figura como entregado. ¡Gracias por usar Rescate!` },
    cancelled: { title: "Pedido cancelado", body: `El pedido ${args.code} fue cancelado.` },
  };
  const message = details[args.status];
  if (!message) return;
  try {
    await sendPushToUser(args.customerId, { ...message, orderId: args.orderId });
  } catch (error) {
    // Push is best-effort and must not make a successful order operation fail.
    console.error("Error enviando notificación de pedido:", error);
  }
}
