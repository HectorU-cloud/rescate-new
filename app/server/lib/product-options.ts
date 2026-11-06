import { asc, inArray } from "drizzle-orm";
import type { OptionGroupInfo } from "@contracts/options";
import { getDb } from "../queries/connection";
import { optionChoices, optionGroups, orderItemOptions, productOptionGroups } from "@db/schema";

/**
 * Grupos de opciones de cada producto (con todas sus opciones, incluidas las agotadas: `isAvailable` dice cuáles).
 * Los productos sin opciones no aparecen en el mapa.
 */
export async function loadOptionGroupsByProduct(productIds: number[]): Promise<Map<number, OptionGroupInfo[]>> {
  const byProduct = new Map<number, OptionGroupInfo[]>();
  if (productIds.length === 0) return byProduct;
  const db = getDb();
  const links = await db
    .select()
    .from(productOptionGroups)
    .where(inArray(productOptionGroups.productId, productIds))
    .orderBy(asc(productOptionGroups.sortOrder), asc(productOptionGroups.id));
  if (links.length === 0) return byProduct;

  const groupIds = [...new Set(links.map((l) => l.groupId))];
  const [groups, choices] = await Promise.all([
    db.select().from(optionGroups).where(inArray(optionGroups.id, groupIds)),
    db.select().from(optionChoices).where(inArray(optionChoices.groupId, groupIds)).orderBy(asc(optionChoices.sortOrder), asc(optionChoices.id)),
  ]);

  const infoById = new Map<number, OptionGroupInfo>(
    groups.map((g) => [g.id, { id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, choices: [] }]),
  );
  for (const c of choices) {
    infoById.get(c.groupId)?.choices.push({ id: c.id, name: c.name, priceDelta: c.priceDelta, isAvailable: c.isAvailable });
  }
  for (const link of links) {
    const info = infoById.get(link.groupId);
    if (!info) continue;
    const list = byProduct.get(link.productId) ?? [];
    list.push(info);
    byProduct.set(link.productId, list);
  }
  return byProduct;
}

export type ItemOptionView = { id: number; groupName: string; choiceName: string; priceDelta: number };

/** Agrega a cada ítem de pedido lo que el cliente eligió (`options`; vacío si el ítem no tenía opciones). */
export async function attachItemOptions<T extends { id: number }>(items: T[]): Promise<Array<T & { options: ItemOptionView[] }>> {
  if (items.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(orderItemOptions)
    .where(inArray(orderItemOptions.orderItemId, items.map((i) => i.id)))
    .orderBy(asc(orderItemOptions.id));
  const byItem = new Map<number, ItemOptionView[]>();
  for (const r of rows) {
    const list = byItem.get(r.orderItemId) ?? [];
    list.push({ id: r.id, groupName: r.groupName, choiceName: r.choiceName, priceDelta: r.priceDelta });
    byItem.set(r.orderItemId, list);
  }
  return items.map((i) => ({ ...i, options: byItem.get(i.id) ?? [] }));
}
