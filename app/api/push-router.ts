import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { pushTokens } from "@db/schema";
import { pushConfigured } from "./lib/push-notifications";

export const pushRouter = createRouter({
  status: authedQuery.query(() => ({ configured: pushConfigured() })),
  register: authedQuery.input(z.object({ token: z.string().min(20).max(700), platform: z.enum(["web", "android", "ios"]).default("web") })).mutation(async ({ ctx, input }) => {
    if (!pushConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Las notificaciones push aún no están configuradas en el servidor." });
    const db = getDb();
    await db.insert(pushTokens).values({ userId: ctx.user.id, token: input.token, platform: input.platform })
      .onDuplicateKeyUpdate({ set: { userId: ctx.user.id, platform: input.platform, updatedAt: new Date() } });
    return { ok: true };
  }),
  unregister: authedQuery.input(z.object({ token: z.string().min(20).max(700) })).mutation(async ({ ctx, input }) => {
    await getDb().delete(pushTokens).where(and(eq(pushTokens.userId, ctx.user.id), eq(pushTokens.token, input.token)));
    return { ok: true };
  }),
});
