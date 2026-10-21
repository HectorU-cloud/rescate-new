import { is, sql } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import type { getDb } from "../server/queries/connection";
import * as schema from "./schema";

type Db = ReturnType<typeof getDb>;
export type Orphans = {
  table: string;
  column: string;
  parentTable: string;
  parentColumn: string;
  onDelete: string;
  count: number;
  /** Consulta para ver las filas huérfanas. */
  inspectSql: string;
  /** Qué hacer con ellas según la regla de borrado de la relación. */
  fixSql: string;
};

const q = (name: string) => `\`${name.replace(/`/g, "")}\``;

/** Todas las claves foráneas declaradas en el esquema (una sola columna cada una). */
export function declaredForeignKeys() {
  const out: Array<{ table: string; column: string; parentTable: string; parentColumn: string; onDelete: string }> = [];
  for (const value of Object.values(schema)) {
    if (!is(value, MySqlTable)) continue;
    const config = getTableConfig(value);
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      if (ref.columns.length !== 1) throw new Error(`Clave foránea compuesta no soportada en ${config.name}`);
      out.push({
        table: config.name,
        column: ref.columns[0].name,
        parentTable: getTableConfig(ref.foreignTable).name,
        parentColumn: ref.foreignColumns[0].name,
        onDelete: fk.onDelete ?? "no action",
      });
    }
  }
  return out;
}

/**
 * Busca filas que apuntan a algo que ya no existe (por ejemplo, un pedido de un cliente que se borró).
 * Con las claves foráneas aplicadas eso ya no puede pasar; sirve para revisar una base ANTIGUA antes
 * de aplicarlas: `db:push` falla si quedan filas huérfanas.
 */
export async function findOrphans(db: Db): Promise<Orphans[]> {
  const results: Orphans[] = [];
  for (const fk of declaredForeignKeys()) {
    const join = `FROM ${q(fk.table)} c LEFT JOIN ${q(fk.parentTable)} p ON c.${q(fk.column)} = p.${q(fk.parentColumn)}`;
    const where = `WHERE c.${q(fk.column)} IS NOT NULL AND p.${q(fk.parentColumn)} IS NULL`;
    const res = (await db.execute(sql.raw(`SELECT COUNT(*) AS n ${join} ${where}`))) as unknown as Array<Array<{ n: number | string }>>;
    const count = Number(res[0]?.[0]?.n ?? 0);
    const inspectSql = `SELECT c.* ${join} ${where};`;
    let fixSql: string;
    if (fk.onDelete === "cascade") {
      fixSql = `DELETE c ${join} ${where};`;
    } else if (fk.onDelete === "set null") {
      fixSql = `UPDATE ${q(fk.table)} c LEFT JOIN ${q(fk.parentTable)} p ON c.${q(fk.column)} = p.${q(fk.parentColumn)} SET c.${q(fk.column)} = NULL ${where};`;
    } else {
      fixSql =
        `-- Revisa a mano: estas filas son parte del historial. Opciones: recrear el registro padre faltante, o borrarlas.\n` +
        `-- Si decides borrarlas: DELETE c ${join} ${where};`;
    }
    results.push({ ...fk, count, inspectSql, fixSql });
  }
  return results;
}

export function formatOrphanReport(found: Orphans[]): string {
  const bad = found.filter((o) => o.count > 0);
  const lines = [`Relaciones revisadas: ${found.length}`];
  if (bad.length === 0) {
    lines.push("✅ No hay datos huérfanos. Puedes ejecutar `npm run db:push` sin problema.");
    return lines.join("\n");
  }
  lines.push(`⚠️  Hay datos huérfanos en ${bad.length} relación(es). \`npm run db:push\` fallaría hasta arreglarlos:\n`);
  for (const o of bad) {
    lines.push(`• ${o.table}.${o.column} → ${o.parentTable}.${o.parentColumn}: ${o.count} fila(s) (regla: ${o.onDelete})`);
    lines.push(`  Ver:     ${o.inspectSql}`);
    lines.push(`  Arreglar:\n    ${o.fixSql.split("\n").join("\n    ")}\n`);
  }
  lines.push("Haz una copia de seguridad antes. Después de arreglar, vuelve a ejecutar `npm run db:check` hasta que salga en verde.");
  return lines.join("\n");
}
