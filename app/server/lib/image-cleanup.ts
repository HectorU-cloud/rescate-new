import { count, eq } from "drizzle-orm";
import { products, rescuePacks, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { deleteStoredImage } from "./image-storage";

/**
 * Tras reemplazar o quitar una imagen, borra la anterior del almacenamiento (ahorra espacio y no deja
 * fotos viejas públicas). Solo borra si está en la carpeta del dueño y ya nadie más la usa.
 * Llamar DESPUÉS de guardar el cambio en la base de datos.
 */
export async function releaseReplacedImage(oldUrl: string | null | undefined, newUrl: string | null | undefined, folder: string) {
  if (!oldUrl || oldUrl === newUrl) return;
  const db = getDb();
  const [p] = await db.select({ n: count() }).from(products).where(eq(products.imageUrl, oldUrl));
  const [r] = await db.select({ n: count() }).from(rescuePacks).where(eq(rescuePacks.imageUrl, oldUrl));
  const [u] = await db.select({ n: count() }).from(users).where(eq(users.courierPhotoUrl, oldUrl));
  if (p.n + r.n + u.n > 0) return;
  await deleteStoredImage(oldUrl, folder);
}
