import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { bayesianRating } from "./business-rules";
import { businesses, ratings, users } from "@db/schema";

/** Recalcula el rating público del comercio a partir de todas sus calificaciones. */
export async function recomputeBusinessRating(businessId: number) {
  const db = getDb();
  const [row] = await db
    .select({ sum: sql<number>`coalesce(sum(${ratings.businessStars}), 0)`, count: sql<number>`count(*)` })
    .from(ratings)
    .where(eq(ratings.businessId, businessId));
  const count = Number(row?.count ?? 0);
  await db.update(businesses).set({ rating: bayesianRating(Number(row?.sum ?? 0), count), ratingCount: count }).where(eq(businesses.id, businessId));
}

/** Recalcula la calificación del repartidor (solo cuenta pedidos donde fue calificado). */
export async function recomputeCourierRating(courierId: number) {
  const db = getDb();
  const [row] = await db
    .select({ sum: sql<number>`coalesce(sum(${ratings.courierStars}), 0)`, count: sql<number>`count(${ratings.courierStars})` })
    .from(ratings)
    .where(eq(ratings.courierId, courierId));
  const count = Number(row?.count ?? 0);
  await db.update(users).set({ courierRating: count ? bayesianRating(Number(row?.sum ?? 0), count) : null, courierRatingCount: count }).where(eq(users.id, courierId));
}
