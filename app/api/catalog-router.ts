import { z } from "zod";
import { and, desc, eq, gt } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { businesses, products, rescuePacks } from "@db/schema";

export const catalogRouter = createRouter({
  // Lista de comercios, opcionalmente filtrados por categoría o búsqueda
  businesses: publicQuery
    .input(
      z
        .object({
          category: z.string().optional(),
          query: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(businesses).orderBy(desc(businesses.rating));
      let out = rows;
      if (input?.category) {
        out = out.filter((b) => b.category === input.category);
      }
      if (input?.query) {
        const q = input.query.toLowerCase();
        out = out.filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            (b.description ?? "").toLowerCase().includes(q),
        );
      }
      return out;
    }),

  businessDetail: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const business = await db.query.businesses.findFirst({
        where: eq(businesses.id, input.id),
      });
      if (!business) return null;
      const prods = await db
        .select()
        .from(products)
        .where(eq(products.businessId, input.id));
      const packs = await db
        .select()
        .from(rescuePacks)
        .where(
          and(
            eq(rescuePacks.businessId, input.id),
            eq(rescuePacks.isActive, true),
            gt(rescuePacks.quantityLeft, 0),
          ),
        );
      return { business, products: prods, rescuePacks: packs };
    }),

  // Todos los packs de rescate activos (sección "Rescate")
  rescuePacks: publicQuery.query(async () => {
    const db = getDb();
    const packs = await db
      .select()
      .from(rescuePacks)
      .where(and(eq(rescuePacks.isActive, true), gt(rescuePacks.quantityLeft, 0)))
      .orderBy(desc(rescuePacks.createdAt));
    const bizRows = await db.select().from(businesses);
    const byId = new Map(bizRows.map((b) => [b.id, b]));
    return packs
      .map((p) => ({ pack: p, business: byId.get(p.businessId) ?? null }))
      .filter((r) => r.business !== null);
  }),
});
