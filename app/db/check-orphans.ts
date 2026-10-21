/**
 * Revisa si la base tiene datos huérfanos antes de aplicar las claves foráneas.
 * Uso: npm run db:check   (usa DATABASE_URL del .env). Solo LEE: no modifica nada.
 */
import { getDb } from "../server/queries/connection";
import { findOrphans, formatOrphanReport } from "./orphans";

async function main() {
  const found = await findOrphans(getDb());
  console.log(formatOrphanReport(found));
  process.exit(found.some((o) => o.count > 0) ? 1 : 0);
}

main().catch((e) => {
  console.error("No se pudo revisar la base:", e instanceof Error ? e.message : e);
  process.exit(2);
});
