import { z } from "zod";
import { and, desc, eq, gt } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { businesses, products, rescuePacks } from "@db/schema";
import { isBusinessOpenNow, isBusinessPublic, isPackReservable } from "./lib/business-rules";
import { isPackExpired } from "@contracts/packs";
import { CITIES, cityById, cityIdForPoint } from "@contracts/cities";
import { loadBusinessesByIds } from "./lib/business-queries";
import { toPublicBusiness } from "./lib/public-business";
import { loadOptionGroupsByProduct } from "./lib/product-options";

// Reservable = no venció (fecha) y estamos dentro de su ventana horaria diaria.
const withReservable = <T extends { pickupStart: string; pickupEnd: string; expiresAt: Date | null }>(p: T) => ({
  ...p,
  reservable: !isPackExpired(p.expiresAt) && isPackReservable(p.pickupStart, p.pickupEnd),
});

const withOpenNow = <T extends { isOpen: boolean; opensAt: string; closesAt: string }>(b: T) => ({ ...b, openNow: isBusinessOpenNow(b) });

/**
 * Filtro por ciudad. La ciudad de un local sale de su pin (ver `cityIdForPoint`), así que no hay nada que mantener:
 * si el dueño mueve el pin, el local cambia de ciudad solo. Sin `cityId` —o con uno que ya no existe en la lista,
 * p. ej. un dispositivo con una ciudad guardada que se retiró— no se filtra nada (se muestran todas).
 */
const inCity = (cityId: string | undefined) => {
  const city = cityById(cityId);
  return (b: { lat: number; lng: number }) => !city || cityIdForPoint(b.lat, b.lng) === city.id;
};

const cityInput = z.object({ cityId: z.string().max(40).optional() });

export const catalogRouter = createRouter({
  // Lista de comercios, opcionalmente filtrados por categoría o búsqueda
  businesses: publicQuery
    .input(
      z
        .object({
          category: z.string().optional(),
          query: z.string().optional(),
          cityId: z.string().max(40).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      // Solo comercios aprobados por el equipo son visibles al público.
      const rows = await db.select().from(businesses).where(and(eq(businesses.approvalStatus, "approved"), eq(businesses.locationConfirmed, true))).orderBy(desc(businesses.rating));
      let out = rows.filter(inCity(input?.cityId));
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
      return out
        .map(toPublicBusiness)
        .map(withOpenNow)
        // Prioriza locales abiertos; dentro de cada grupo mantiene el rating descendente.
        .sort((a, b) => Number(b.openNow) - Number(a.openNow) || b.rating - a.rating);
    }),

  businessDetail: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const business = await db.query.businesses.findFirst({
        where: eq(businesses.id, input.id),
      });
      if (!business) return null;
      // Un comercio sin aprobar solo lo ven su dueño y los administradores.
      const canSeeUnapproved = ctx.user && (ctx.user.id === business.ownerId || ctx.user.role === "admin");
      if (!isBusinessPublic(business) && !canSeeUnapproved) return null;
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
            gt(rescuePacks.expiresAt, new Date()), // los vencidos (o sin fecha) no se muestran
          ),
        );
      // Cada producto trae sus grupos de opciones (sabor, tamaño, extras…); vacío si es un producto simple.
      const optionsByProduct = await loadOptionGroupsByProduct(prods.map((p) => p.id));
      const productsWithOptions = prods.map((p) => ({ ...p, optionGroups: optionsByProduct.get(p.id) ?? [] }));
      return { business: withOpenNow(toPublicBusiness(business)), products: productsWithOptions, rescuePacks: packs.map(withReservable) };
    }),

  // Cuántos locales visibles hay en cada ciudad (para el selector de ciudad). Solo lee las coordenadas.
  cityCounts: publicQuery.query(async () => {
    const rows = await getDb()
      .select({ lat: businesses.lat, lng: businesses.lng })
      .from(businesses)
      .where(and(eq(businesses.approvalStatus, "approved"), eq(businesses.locationConfirmed, true)));
    const counts = new Map<string, number>(CITIES.map((c) => [c.id, 0]));
    for (const r of rows) {
      const id = cityIdForPoint(r.lat, r.lng);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return CITIES.map((c) => ({ cityId: c.id, businesses: counts.get(c.id) ?? 0 }));
  }),

  // Todos los packs de rescate activos (sección "Rescate"), opcionalmente solo los de una ciudad
  rescuePacks: publicQuery.input(cityInput.optional()).query(async ({ input }) => {
    const sameCity = inCity(input?.cityId);
    const db = getDb();
    const packs = await db
      .select()
      .from(rescuePacks)
      .where(and(eq(rescuePacks.isActive, true), gt(rescuePacks.quantityLeft, 0), gt(rescuePacks.expiresAt, new Date())))
      .orderBy(desc(rescuePacks.createdAt));
    const byId = await loadBusinessesByIds(packs.map((p) => p.businessId));
    return packs
      .map((p) => {
        const business = byId.get(p.businessId) ?? null;
        return {
          pack: withReservable(p),
          business: business ? withOpenNow(business) : null,
        };
      })
      .filter((r) => r.business !== null && isBusinessPublic(r.business) && sameCity(r.business))
      // Primero los comercios abiertos; después, los que están cerrados.
      .sort((a, b) => Number(b.business!.openNow) - Number(a.business!.openNow));
  }),
});
