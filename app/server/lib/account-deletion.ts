import { randomBytes } from "node:crypto";
import { and, eq, notInArray, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  authTokens,
  businesses,
  claims,
  courierLocations,
  customerAddresses,
  orderMessages,
  orders,
  pushTokens,
  ratings,
  rescuePacks,
  users,
  type User,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { courierPhotoFolder } from "./image-storage";
import { releaseReplacedImage } from "./image-cleanup";

export const DELETE_ACCOUNT_CONFIRMATION = "ELIMINAR";
const FINISHED = ["delivered", "cancelled"] as const;
const DELETED_NAME = "Cuenta eliminada";

/**
 * Derecho de supresión (LOPDP): elimina los datos personales de la cuenta.
 *
 * No se borra la fila de `users` porque pedidos, reclamos y chats la referencian con claves `restrict`
 * (y los comercios necesitan su historial contable). En su lugar se ANONIMIZA: nombre, correo, teléfono,
 * contraseña, foto, direcciones, dispositivos push, ubicación GPS y los textos libres que escribió.
 * El `unionId` pasa a un valor aleatorio, así que volver a entrar con el mismo correo o Google crea una cuenta nueva.
 *
 * Se rechaza si hay pedidos en curso, para no dejar a un cliente, comercio o repartidor a medias.
 */
export async function deleteAccount(user: User): Promise<void> {
  if (user.role === "admin") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Una cuenta de administrador no se puede eliminar desde la app. Quita primero el rol de administrador." });
  }
  const db = getDb();
  const [business] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.ownerId, user.id)).limit(1);

  const involved = [eq(orders.customerId, user.id), eq(orders.courierId, user.id), ...(business ? [eq(orders.businessId, business.id)] : [])];
  const [active] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(or(...involved), notInArray(orders.status, [...FINISHED])))
    .limit(1);
  if (active) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Tienes pedidos en curso. Termínalos o cancélalos y vuelve a intentarlo.",
    });
  }

  const oldPhoto = user.courierPhotoUrl;
  await db.transaction(async (tx) => {
    // Datos que solo tienen sentido con la cuenta viva
    await tx.delete(customerAddresses).where(eq(customerAddresses.userId, user.id));
    await tx.delete(authTokens).where(eq(authTokens.userId, user.id));
    await tx.delete(pushTokens).where(eq(pushTokens.userId, user.id));
    await tx.delete(courierLocations).where(eq(courierLocations.courierId, user.id));

    // Datos personales dentro del historial (el pedido y sus montos se conservan)
    await tx
      .update(orders)
      .set({ customerName: DELETED_NAME, customerPhone: null, deliveryAddress: null, deliveryLat: null, deliveryLng: null, notes: null })
      .where(eq(orders.customerId, user.id));
    await tx.update(orderMessages).set({ body: "[mensaje eliminado]" }).where(eq(orderMessages.senderId, user.id));
    await tx.update(claims).set({ reason: "[texto eliminado por su autor]" }).where(eq(claims.userId, user.id));
    await tx.update(ratings).set({ businessComment: null, courierComment: null }).where(eq(ratings.customerId, user.id));

    // Un comercio sin dueño deja de publicarse; su historial de pedidos queda intacto
    if (business) {
      await tx
        .update(businesses)
        .set({
          isOpen: false,
          approvalStatus: "rejected",
          approvalNote: "El dueño eliminó su cuenta.",
          phone: null,
          pendingName: null,
          pendingAddress: null,
        })
        .where(eq(businesses.id, business.id));
      await tx.update(rescuePacks).set({ isActive: false }).where(eq(rescuePacks.businessId, business.id));
    }

    await tx
      .update(users)
      .set({
        unionId: `deleted:${user.id}:${randomBytes(12).toString("hex")}`,
        name: DELETED_NAME,
        email: null,
        passwordHash: null,
        emailVerifiedAt: null,
        avatar: null,
        phone: null,
        appRole: null,
        courierPhotoUrl: null,
        courierVehicle: null,
        courierPlate: null,
        courierBio: null,
        courierApproved: false,
        courierVerification: "pending",
        courierReviewNote: null,
        courierAvailable: false,
        sessionVersion: user.sessionVersion + 1, // invalida la sesión actual y cualquier otra
        deletedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  });

  // Fuera de la transacción y sin romper la eliminación si el almacenamiento falla
  await releaseReplacedImage(oldPhoto, null, courierPhotoFolder(user.id)).catch((e) => console.error("[account-deletion] no se pudo borrar la foto:", e));
}
