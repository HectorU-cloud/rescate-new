import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "@db/schema";
import { declaredForeignKeys } from "@db/orphans";

/** Política de borrado esperada de cada relación. Si cambias una, este test te obliga a hacerlo a propósito. */
const EXPECTED = [
  // Lo que no tiene sentido sin su dueño se borra con él
  "customer_addresses.userId -> users (cascade)",
  "auth_tokens.userId -> users (cascade)",
  "push_tokens.userId -> users (cascade)",
  "products.businessId -> businesses (cascade)",
  "rescue_packs.businessId -> businesses (cascade)",
  "order_items.orderId -> orders (cascade)",
  "order_events.orderId -> orders (cascade)",
  "order_messages.orderId -> orders (cascade)",
  "courier_locations.orderId -> orders (cascade)",
  "courier_locations.courierId -> users (cascade)",
  "claims.orderId -> orders (cascade)",
  "ratings.orderId -> orders (cascade)",
  // El historial protege: no se puede borrar un usuario o comercio que tiene pedidos, mensajes, reclamos o valoraciones
  "businesses.ownerId -> users (restrict)",
  "orders.customerId -> users (restrict)",
  "orders.businessId -> businesses (restrict)",
  "order_messages.courierId -> users (restrict)",
  "order_messages.senderId -> users (restrict)",
  "claims.userId -> users (restrict)",
  "ratings.customerId -> users (restrict)",
  "ratings.businessId -> businesses (restrict)",
  // El registro se conserva aunque desaparezca quien lo originó o el producto
  "orders.courierId -> users (set null)",
  "order_items.productId -> products (set null)",
  "order_items.rescuePackId -> rescue_packs (set null)",
  "order_events.actorId -> users (set null)",
  "claims.resolvedBy -> users (set null)",
  "ratings.courierId -> users (set null)",
  // Finanzas: conservar movimientos aunque se elimine el usuario/pedido de origen.
  "finance_settings.updatedBy -> users (set null)",
  "notifications.userId -> users (cascade)",
  "notifications.orderId -> orders (set null)",
  "wallet_entries.createdBy -> users (set null)",
  "wallet_entries.orderId -> orders (set null)",
  "wallet_entries.reviewedBy -> users (set null)",
  "settlements.createdBy -> users (set null)",
].sort();

const tables = Object.values(schema).filter((v) => is(v, MySqlTable)) as unknown as MySqlTable[];

describe("integridad del esquema (claves foráneas)", () => {
  const fks = declaredForeignKeys();

  it("la política de borrado de cada relación es la esperada", () => {
    const actual = fks.map((f) => `${f.table}.${f.column} -> ${f.parentTable} (${f.onDelete})`).sort();
    expect(actual).toEqual(EXPECTED);
  });

  it("toda columna que apunta a otra tabla tiene su clave foránea (así una relación nueva no queda sin proteger)", () => {
    // wallet_entries.walletId y settlements.walletId son referencias polimórficas: según walletType apunta a users.id
    // (courier) o businesses.id (business). MySQL no permite una FK que apunte condicionalmente
    // a dos tablas; la validación del tipo y la existencia se debe hacer en la capa de servicio.
    const polymorphicReferences = new Set(["wallet_entries.walletId", "settlements.walletId"]);
    const withFk = new Set(fks.map((f) => `${f.table}.${f.column}`));
    const unprotected: string[] = [];
    for (const table of tables) {
      const config = getTableConfig(table);
      for (const col of config.columns) {
        // Los ids de relación son bigint sin signo (como users.id); la clave primaria propia se llama "id"
        if (col.getSQLType() === "bigint unsigned" && col.name !== "id" && !withFk.has(`${config.name}.${col.name}`) && !polymorphicReferences.has(`${config.name}.${col.name}`)) {
          unprotected.push(`${config.name}.${col.name}`);
        }
      }
    }
    expect(unprotected).toEqual([]);
  });

  it("todas apuntan a la columna id de la tabla padre", () => {
    expect(fks.filter((f) => f.parentColumn !== "id")).toEqual([]);
  });

  it("no hay relaciones duplicadas", () => {
    const keys = fks.map((f) => `${f.table}.${f.column}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("toda relación que permite NULL usa 'set null' y toda 'set null' sobre una columna que acepta NULL", () => {
    const byName = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));
    for (const f of fks) {
      const col = byName.get(f.table)!.columns.find((c) => c.name === f.column)!;
      if (f.onDelete === "set null") expect(col.notNull, `${f.table}.${f.column} debe aceptar NULL`).toBe(false);
      else expect(col.notNull, `${f.table}.${f.column} es obligatoria`).toBe(true);
    }
  });
});
