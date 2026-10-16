import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    // Drizzle lee y escribe los TIMESTAMP asumiendo UTC. Si la base corre en otra zona (por ejemplo
    // hora de Ecuador), los valores que pone la propia base (defaultNow) salen desfasados y los
    // vencimientos automáticos de pedidos se descuadran. Forzamos UTC en cada conexión.
    const pool = createPool({ uri: env.databaseUrl, timezone: "Z" });
    pool.on("connection", (connection) => {
      connection.query("SET time_zone = '+00:00'", () => undefined);
    });
    instance = drizzle(pool, { mode: "planetscale", schema: fullSchema });
  }
  return instance;
}
