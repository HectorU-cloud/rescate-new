/**
 * Compara el esquema del código (db/schema.ts) con la base real y dice qué tablas y columnas faltan.
 * Uso: npm run db:check-schema   (usa DATABASE_URL del .env o de la base de producción). Solo LEE: no modifica nada.
 *
 * Sirve para diagnosticar errores 500 tras un despliegue: si el código usa una tabla o columna que la base
 * todavía no tiene (por ejemplo `finance_settings`), las consultas fallan. Solo revisa que EXISTAN; no compara tipos.
 */
import { createPool } from "mysql2/promise";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "./schema";
import { env } from "../server/lib/env";

type Missing = { table: string; columns: string[] | "ALL" };

async function main() {
  const pool = createPool({ uri: env.databaseUrl });
  try {
    const [rows] = await pool.query("SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()");
    const live = new Map<string, Set<string>>();
    for (const r of rows as Array<{ t: string; c: string }>) {
      const key = r.t.toLowerCase();
      if (!live.has(key)) live.set(key, new Set());
      live.get(key)!.add(r.c.toLowerCase());
    }

    const missing: Missing[] = [];
    let tables = 0;
    for (const value of Object.values(schema)) {
      if (!is(value, MySqlTable)) continue;
      tables++;
      const config = getTableConfig(value);
      const columns = live.get(config.name.toLowerCase());
      if (!columns) { missing.push({ table: config.name, columns: "ALL" }); continue; }
      const absent = config.columns.map((c) => c.name).filter((name) => !columns.has(name.toLowerCase()));
      if (absent.length) missing.push({ table: config.name, columns: absent });
    }

    if (!missing.length) {
      console.log(`✔ La base tiene todas las tablas y columnas del código (${tables} tablas revisadas).`);
      return;
    }
    console.log(`✖ A la base le falta esquema que el código ya usa (${missing.length} de ${tables} tablas afectadas):\n`);
    for (const m of missing) console.log(m.columns === "ALL" ? `  • Tabla completa: ${m.table}` : `  • ${m.table}: columnas ${m.columns.join(", ")}`);
    console.log("\nCómo arreglarlo: respalda la base y aplica el esquema (ver README, sección de migraciones; en esta etapa del proyecto se ha usado `npm run db:push`).");
    console.log("Revisa el diff que muestre drizzle-kit y NO aceptes renombrados ni eliminaciones de columnas existentes.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("No se pudo revisar la base:", e instanceof Error ? e.message : e);
  process.exit(2);
});
