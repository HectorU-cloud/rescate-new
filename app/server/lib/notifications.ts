import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { notifications } from "@db/schema";
import { getDb } from "../queries/connection";

export type InAppNotification = { title: string; body: string; url?: string; orderId?: number; tag?: string };

const DAY = 24 * 3600_000;
/** Los avisos leídos se conservan 30 días y los no leídos 90. */
export const READ_RETENTION_DAYS = 30;
export const UNREAD_RETENTION_DAYS = 90;

/**
 * Guarda un aviso en el historial del usuario (lo que ve en la campana).
 * Con `tag`, si ya hay un aviso SIN LEER con la misma etiqueta se actualiza en vez de duplicarlo
 * (así 10 mensajes de chat seguidos son una sola fila).
 */
export async function recordNotification(userId: number, n: InAppNotification): Promise<void> {
  const db = getDb();
  const values = {
    title: n.title.slice(0, 120),
    body: n.body.slice(0, 300),
    url: n.url?.slice(0, 200) ?? (n.orderId ? `/pedido/${n.orderId}` : null),
    orderId: n.orderId ?? null,
    tag: n.tag?.slice(0, 80) ?? null,
  };
  if (values.tag) {
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.tag, values.tag), isNull(notifications.readAt)))
      .limit(1);
    if (existing) {
      await db.update(notifications).set({ ...values, createdAt: new Date() }).where(eq(notifications.id, existing.id));
      return;
    }
  }
  await db.insert(notifications).values({ userId, ...values });
}

/** Borra avisos viejos. Se llama periódicamente desde el mantenimiento. */
export async function pruneNotifications(now = Date.now()): Promise<void> {
  await getDb()
    .delete(notifications)
    .where(or(
      lt(notifications.createdAt, new Date(now - UNREAD_RETENTION_DAYS * DAY)),
      and(isNotNull(notifications.readAt), lt(notifications.readAt, new Date(now - READ_RETENTION_DAYS * DAY))),
    ));
}
