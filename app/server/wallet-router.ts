import { and, desc, eq } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { businesses, walletEntries } from "@db/schema";
import { walletSummary } from "./lib/wallet";

/** Estado de cuenta de quien consulta: el repartidor ve el suyo y el dueño de un comercio, el de su local. */
export const walletRouter = createRouter({
  mine: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    let walletType: "courier" | "business";
    let walletId: number;
    if (ctx.user.appRole === "courier") {
      walletType = "courier";
      walletId = ctx.user.id;
    } else if (ctx.user.appRole === "business") {
      const [biz] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.ownerId, ctx.user.id)).limit(1);
      if (!biz) return null;
      walletType = "business";
      walletId = biz.id;
    } else {
      return null;
    }
    const summary = await walletSummary(walletType, walletId);
    // Solo columnas útiles para la persona: nada de quién lo creó o revisó.
    const entries = await db
      .select({
        id: walletEntries.id,
        entryType: walletEntries.entryType,
        amount: walletEntries.amount,
        status: walletEntries.status,
        description: walletEntries.description,
        paymentReference: walletEntries.paymentReference,
        orderId: walletEntries.orderId,
        createdAt: walletEntries.createdAt,
      })
      .from(walletEntries)
      .where(and(eq(walletEntries.walletType, walletType), eq(walletEntries.walletId, walletId)))
      .orderBy(desc(walletEntries.createdAt), desc(walletEntries.id))
      .limit(30);
    return { walletType, ...summary, entries };
  }),
});
