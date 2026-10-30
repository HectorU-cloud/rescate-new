import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { notifications } from "@db/schema";

/** Centro de notificaciones del usuario. Cada consulta se limita a las filas de quien la hace. */
export const notificationsRouter = createRouter({
  list: authedQuery
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).default({ limit: 30 }))
    .query(async ({ ctx, input }) => {
      return getDb()
        .select()
        .from(notifications)
        .where(eq(notifications.userId, ctx.user.id))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(input.limit);
    }),

  unreadCount: authedQuery.query(async ({ ctx }) => {
    const [row] = await getDb()
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return { count: Number(row?.count ?? 0) };
  }),

  markRead: authedQuery.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await getDb()
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return { ok: true };
  }),

  markAllRead: authedQuery.mutation(async ({ ctx }) => {
    await getDb()
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return { ok: true };
  }),
});
