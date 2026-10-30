import { importPKCS8, SignJWT } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { businesses, orders, pushTokens, users } from "@db/schema";
import { chatPreview, type ChatRole } from "./chat-rules";
import { recordNotification } from "./notifications";

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

export async function sendPushToUser(userId: number, notification: { title: string; body: string; url?: string; orderId?: number; tag?: string }) {
  // Historial dentro de la app: se guarda siempre, haya o no push configurado o dispositivos registrados.
  // Un fallo aquí (p. ej. usuario inexistente) nunca debe impedir el envío del push.
  await recordNotification(userId, notification).catch((error) => console.error("No se pudo guardar la notificación interna:", error));
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
          ...(notification.tag ? { tag: notification.tag } : {}),
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

export async function notifyOrderStatus(args: { customerId: number; orderId: number; code: string; status: string; type: "delivery" | "rescue"; reason?: string; prepMinutes?: number }) {
  const details: Record<string, { title: string; body: string }> = {
    pending: { title: "Pedido recibido 🧾", body: `Recibimos tu pedido ${args.code}. Avisaremos cuando el local lo confirme.` },
    accepted: args.type === "rescue" ? { title: "Pack reservado 🧡", body: `Tu pack ${args.code} quedó reservado para retirar en el local.` } : { title: "Pedido confirmado ✅", body: `El local confirmó tu pedido ${args.code}.${args.prepMinutes ? ` Estará listo en unos ${args.prepMinutes} min.` : ""}` },
    preparing: { title: "¡Están preparando tu pedido! 👨‍🍳", body: `El local ya está preparando el pedido ${args.code}.` },
    ready: { title: args.type === "rescue" ? "Tu pack está listo 🧡" : "Tu pedido está listo 🍽️", body: args.type === "rescue" ? `Tu pack ${args.code} está listo para retirar.` : `El pedido ${args.code} está listo para el repartidor.` },
    picked_up: { title: "¡Tu pedido va en camino! 🛵", body: `El repartidor recogió tu pedido ${args.code}.` },
    delivered: { title: "Pedido entregado 🎉", body: `El pedido ${args.code} figura como entregado. ¡Gracias por usar Rescate!` },
    cancelled: { title: "Pedido cancelado", body: `El pedido ${args.code} fue cancelado.${args.reason ? ` Motivo: ${args.reason}` : ""}` },
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

/** Envía una notificación a varios usuarios sin que un fallo individual afecte a los demás. */
export async function sendPushToUsers(userIds: number[], notification: { title: string; body: string; url?: string; orderId?: number }) {
  const unique = [...new Set(userIds)];
  let sent = 0;
  // Lotes pequeños para no saturar FCM ni la base de datos.
  for (let i = 0; i < unique.length; i += 10) {
    const results = await Promise.allSettled(unique.slice(i, i + 10).map((id) => sendPushToUser(id, notification)));
    for (const r of results) {
      if (r.status === "fulfilled") sent += r.value.sent;
      else console.error("Error enviando push a un usuario:", r.reason);
    }
  }
  return { recipients: unique.length, sent };
}

/** IDs de repartidores aprobados que están disponibles para recibir pedidos. */
export async function availableCourierIds() {
  const rows = await getDb().select({ id: users.id }).from(users).where(and(
    eq(users.appRole, "courier"),
    eq(users.courierApproved, true),
    eq(users.courierAvailable, true),
  ));
  return rows.map((r) => r.id);
}

/** Avisa a los repartidores que hay un pedido listo para recoger. */
export async function notifyCouriersOrderReady(orderId: number, opts: { reminder?: boolean } = {}) {
  try {
    const db = getDb();
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.status, "ready"), isNull(orders.courierId))).limit(1);
    if (!order || order.type !== "delivery") return { recipients: 0, sent: 0 };
    const [biz] = await db.select().from(businesses).where(eq(businesses.id, order.businessId)).limit(1);
    const ids = await availableCourierIds();
    if (!ids.length) return { recipients: 0, sent: 0 };
    const place = biz?.name ?? "un local";
    const fee = order.deliveryFee.toFixed(2);
    const distance = order.deliveryDistanceKm != null ? ` · ${order.deliveryDistanceKm} km` : "";
    return await sendPushToUsers(ids, {
      title: opts.reminder ? "⏰ Pedido esperando repartidor" : "🛵 Nuevo pedido listo para recoger",
      body: `${place} · ganas $${fee}${distance}. Toca para tomarlo.`,
      url: "/repartidor",
      orderId: order.id,
    });
  } catch (error) {
    // Best-effort: el pedido ya cambió de estado y no debe fallar por el push.
    console.error("Error avisando a repartidores:", error);
    return { recipients: 0, sent: 0 };
  }
}

/**
 * Avisa por push al otro participante del chat. Usa su propio `tag` para que el mensaje no
 * reemplace las notificaciones de estado del pedido (y varios mensajes seguidos se agrupen).
 * Nunca lanza: el mensaje ya quedó guardado y el push es best-effort.
 */
export async function notifyChatMessage(args: {
  recipientId: number;
  orderId: number;
  fromRole: ChatRole;
  senderName?: string | null;
  body: string;
}) {
  try {
    const fromCourier = args.fromRole === "courier";
    const name = args.senderName?.trim().split(/\s+/)[0];
    await sendPushToUser(args.recipientId, {
      title: `💬 ${name ? `${name} · ` : ""}${fromCourier ? "tu repartidor" : "tu cliente"}`,
      body: chatPreview(args.body),
      // El cliente abre el pedido con el chat desplegado; el repartidor va a su panel.
      url: fromCourier ? `/pedido/${args.orderId}#chat` : "/repartidor",
      orderId: args.orderId,
      tag: `rescate-chat-${args.orderId}`,
    });
  } catch (error) {
    console.error("Error enviando notificación de chat:", error);
  }
}

/** Recuerda al comercio que un delivery lleva mucho tiempo sin avanzar (y cuándo se cancelará solo). */
export async function notifyBusinessStalled(args: { orderId: number; code: string; businessId: number; status: string; idleMin: number; timeoutMin: number }) {
  try {
    const [biz] = await getDb().select().from(businesses).where(eq(businesses.id, args.businessId)).limit(1);
    if (!biz) return;
    const where = args.status === "preparing" ? "en preparación" : "aceptado";
    const left = Math.max(1, args.timeoutMin - args.idleMin);
    await sendPushToUser(biz.ownerId, {
      title: "⏰ Pedido sin avanzar",
      body: `${args.code} lleva ${args.idleMin} min ${where}. Márcalo como listo o cancélalo; si no, se cancelará solo en ~${left} min.`,
      url: "/panel",
      orderId: args.orderId,
    });
  } catch (error) {
    console.error("Error avisando al comercio de un pedido sin avanzar:", error);
  }
}

