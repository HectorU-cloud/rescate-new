import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";

export const profileRouter = createRouter({
  setAppRole: authedQuery
    .input(z.object({ appRole: z.enum(["customer", "business", "courier"]) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(users)
        .set({ appRole: input.appRole })
        .where(eq(users.id, ctx.user.id));
      return { ok: true };
    }),

  updatePhone: authedQuery
    .input(z.object({ phone: z.string().min(6).max(30) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(users)
        .set({ phone: input.phone })
        .where(eq(users.id, ctx.user.id));
      return { ok: true };
    }),
});
