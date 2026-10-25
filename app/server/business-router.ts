import { z } from "zod";
import { randomInt } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { cancelOrderAndRestock } from "./lib/orders";
import { getDb } from "./queries/connection";
import { BUSINESS_RULES } from "@contracts/constants";
import { computePackExpiry, isPackExpired } from "@contracts/packs";
import { distanceMeters, isInServiceArea } from "@contracts/geo";
import { codesMatch } from "./lib/codes";
import { assertValidImageUrl, businessImageFolder, createImageUploadUrl, deleteStoredImage, promoteStagedImageUrl, type SupportedImageMime } from "./lib/image-storage";
import { releaseReplacedImage } from "./lib/image-cleanup";
import { IMAGE_RULES } from "@contracts/constants";
import { notifyCouriersOrderReady, notifyOrderStatus, sendPushToUser, sendPushToUsers } from "./lib/push-notifications";
import { logOrderEvent } from "./lib/order-events";
import { MIN_CANCEL_REASON_LENGTH, businessCancelNeedsReason, businessCancelableFrom, canBusinessCancel } from "./lib/order-rules";
import { startOfDayEcuador } from "./lib/business-rules";
import {
  businesses,
  orderItems,
  orders,
  products,
  ratings,
  rescuePacks,
  users,
  type OrderStatus,
} from "@db/schema";

async function requireMyBusiness(userId: number) {
  const biz = await getDb().query.businesses.findFirst({
    where: eq(businesses.ownerId, userId),
  });
  if (!biz) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Primero registra tu negocio",
    });
  }
  return biz;
}

function assertInServiceArea(lat: number, lng: number) {
  if (!isInServiceArea(lat, lng)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `La ubicación está fuera de la zona de servicio (${BUSINESS_RULES.serviceAreaRadiusKm} km alrededor de Milagro). Revisa el pin en el mapa.`,
    });
  }
}

/**
 * Campos a guardar al fijar la ubicación real del local. Si el local ya estaba confirmado y aprobado
 * y el pin queda a más de `locationReviewMeters` de la ÚLTIMA ubicación aprobada, vuelve a revisión
 * (evita aprobar un sitio y cambiarlo). Se mide contra la ubicación aprobada y no contra el pin actual:
 * si no, con pasos de 299 m se llegaría tan lejos como se quisiera sin revisión.
 */
function locationChange(
  current: { lat: number; lng: number; locationConfirmed: boolean; approvalStatus: string; approvedLat?: number | null; approvedLng?: number | null },
  lat: number,
  lng: number,
) {
  assertInServiceArea(lat, lng);
  const live = current.locationConfirmed && current.approvalStatus === "approved";
  // Locales aprobados antes de existir esta referencia: su pin actual es la mejor referencia disponible.
  const baseLat = current.approvedLat ?? current.lat;
  const baseLng = current.approvedLng ?? current.lng;
  const needsReview = live && distanceMeters(baseLat, baseLng, lat, lng) > BUSINESS_RULES.locationReviewMeters;
  return {
    needsReview,
    fields: {
      lat,
      lng,
      locationConfirmed: true,
      // La referencia solo la mueve un admin al aprobar; aquí se fija si aún no existía.
      ...(live ? { approvedLat: baseLat, approvedLng: baseLng } : {}),
      // Local aprobado que confirma su ubicación por primera vez: ese punto es la referencia.
      ...(!current.locationConfirmed && current.approvalStatus === "approved" ? { approvedLat: lat, approvedLng: lng } : {}),
      ...(needsReview
        ? { approvalStatus: "pending" as const, approvalNote: "Cambió la ubicación del local: requiere nueva revisión.", isOpen: false }
        : {}),
    },
  };
}

async function notifyAdminsLocationReview(businessName: string) {
  const admins = await getDb().select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  await sendPushToUsers(admins.map((a) => a.id), { title: "Local movió su ubicación 📍", body: `${businessName} requiere nueva revisión.`, url: "/admin" }).catch(() => undefined);
}

// Transiciones que el comercio puede aplicar
const BUSINESS_NEXT: Record<string, OrderStatus[]> = {
  pending: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"], // cancelar en cocina: solo delivery (ver canBusinessCancel)
  ready: ["delivered", "cancelled"], // rescate: entregar al retirar; delivery: lo toma el repartidor o se cancela
};

export const businessRouter = createRouter({
  // URL prefirmada para subir una imagen directamente a S3/R2 sin enviar Base64 al backend.
  createImageUpload: authedQuery
    .input(z.object({
      contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      kind: z.enum(["product", "rescue-pack"]),
      // Tamaño exacto del archivo en bytes: queda atado a la firma de la URL de subida
      size: z.number().int().min(1).max(IMAGE_RULES.maxBytes),
    }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      return createImageUploadUrl({
        businessId: biz.id,
        contentType: input.contentType as SupportedImageMime,
        size: input.size,
        kind: input.kind,
        userId: ctx.user.id,
      });
    }),
  myBusiness: authedQuery.query(async ({ ctx }) => {
    return (
      (await getDb().query.businesses.findFirst({
        where: eq(businesses.ownerId, ctx.user.id),
      })) ?? null
    );
  }),

  upsertBusiness: authedQuery
    .input(
      z.object({
        name: z.string().min(2).max(150),
        description: z.string().max(500).optional(),
        category: z.string().min(2).max(60),
        address: z.string().min(5).max(255),
        phone: z.string().max(30).optional(),
        emoji: z.string().max(8).optional(),
        deliveryFee: z.number().min(0).max(20),
        deliveryMinutes: z.number().min(5).max(120),
        // Reglas de entrega (opcionales para no romper formularios existentes)
        feePerKm: z.number().min(0).max(5).optional(),
        deliveryRadiusKm: z.number().min(0.5).max(BUSINESS_RULES.maxDeliveryRadiusKm).optional(),
        minOrder: z.number().min(0).max(200).optional(),
        opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)").optional(),
        closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)").optional(),
        // Ubicación real del local (pin del mapa). Obligatoria al registrarlo.
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { lat, lng, ...data } = input;
      if ((lat === undefined) !== (lng === undefined)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Envía latitud y longitud juntas" });
      }
      const db = getDb();
      const existing = await db.query.businesses.findFirst({
        where: eq(businesses.ownerId, ctx.user.id),
      });
      if (existing) {
        const loc = lat !== undefined && lng !== undefined ? locationChange(existing, lat, lng) : null;
        const nameChanged = data.name !== existing.name;
        const addressChanged = data.address !== existing.address;
        const isApproved = existing.approvalStatus === "approved";
        // En un local aprobado, nombre y dirección nuevos no se publican hasta que un admin los apruebe.
        const requiresBusinessReview = isApproved && (nameChanged || addressChanged);
        const safeData = requiresBusinessReview
          ? { ...data, name: existing.name, address: existing.address }
          : data;
        // Lo pendiente refleja SIEMPRE lo que el dueño envió ahora: si vuelve al nombre/dirección publicados,
        // la propuesta se descarta (si no, el admin aprobaría un cambio que el dueño ya había desistido).
        // Si el local no está aprobado, los datos se aplican directo y no puede quedar nada pendiente.
        const nextPendingName = isApproved && nameChanged ? data.name : null;
        const nextPendingAddress = isApproved && addressChanged ? data.address : null;
        await db.update(businesses).set({
          ...safeData,
          pendingName: nextPendingName,
          pendingAddress: nextPendingAddress,
          ...(existing.approvalStatus === "rejected" ? { approvalStatus: "pending" as const, approvalNote: null } : {}),
          ...(loc?.fields ?? {}),
        }).where(eq(businesses.id, existing.id));
        if (loc?.needsReview) await notifyAdminsLocationReview(existing.name);
        // Se avisa al admin solo cuando la propuesta es nueva o cambió (no en cada guardado).
        const proposalChanged = nextPendingName !== existing.pendingName || nextPendingAddress !== existing.pendingAddress;
        if (requiresBusinessReview && proposalChanged) {
          const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
          await sendPushToUsers(admins.map((a) => a.id), { title: "Cambio de comercio por revisar 🏪", body: `${existing.name} solicitó cambiar ${nextPendingName && nextPendingAddress ? "nombre y dirección" : nextPendingName ? "el nombre" : "la dirección"}.`, url: "/admin" }).catch(() => undefined);
        }
        return { id: existing.id, reviewRequired: requiresBusinessReview };
      }
      if (lat === undefined || lng === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Marca la ubicación de tu local en el mapa" });
      }
      assertInServiceArea(lat, lng);
      const [{ id }] = await db
        .insert(businesses)
        .values({
          ...data,
          ownerId: ctx.user.id,
          lat,
          lng,
          locationConfirmed: true,
          approvalStatus: "pending",
        })
        .$returningId();
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
      await sendPushToUsers(admins.map((a) => a.id), { title: "Nuevo comercio por aprobar 🏪", body: `${input.name} solicita publicarse.`, url: "/admin" }).catch(() => undefined);
      return { id, reviewRequired: false };
    }),

  // Reglas de entrega y horario (sin tocar el resto de datos del local)
  updateRules: authedQuery
    .input(
      z.object({
        deliveryFee: z.number().min(0).max(20),
        feePerKm: z.number().min(0).max(5),
        deliveryRadiusKm: z.number().min(0.5).max(BUSINESS_RULES.maxDeliveryRadiusKm),
        minOrder: z.number().min(0).max(200),
        opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)"),
        closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      await getDb().update(businesses).set(input).where(eq(businesses.id, biz.id));
      return { ok: true };
    }),

  // Fija (o corrige) el punto exacto del local en el mapa
  setLocation: authedQuery
    .input(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const { fields, needsReview } = locationChange(biz, input.lat, input.lng);
      await getDb().update(businesses).set(fields).where(eq(businesses.id, biz.id));
      if (needsReview) await notifyAdminsLocationReview(biz.name);
      return { ok: true, needsReview };
    }),

  toggleOpen: authedQuery
    .input(z.object({ isOpen: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      if (input.isOpen && biz.approvalStatus !== "approved") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tu negocio aún no ha sido aprobado por el equipo." });
      }
      if (input.isOpen && !biz.locationConfirmed) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Marca la ubicación de tu local en el mapa antes de abrir." });
      }
      await getDb()
        .update(businesses)
        .set({ isOpen: input.isOpen })
        .where(eq(businesses.id, biz.id));
      return { ok: true };
    }),

  // Pedidos del comercio (activos e historial)
  orders: authedQuery
    .input(z.object({ activeOnly: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const db = getDb();
      const rows = await db
        .select()
        .from(orders)
        .where(eq(orders.businessId, biz.id))
        .orderBy(desc(orders.createdAt));
      const filtered = input?.activeOnly
        ? rows.filter((o) => !["delivered", "cancelled"].includes(o.status))
        : rows;
      const ids = filtered.map((o) => o.id);
      const items =
        ids.length > 0
          ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids))
          : [];
      const byOrder = new Map<number, typeof items>();
      for (const it of items) {
        const arr = byOrder.get(it.orderId) ?? [];
        arr.push(it);
        byOrder.set(it.orderId, arr);
      }
      return filtered.map((o) => ({
        // Los códigos del cliente son privados; el comercio recibe su código para entregar al repartidor.
        order: { ...o, deliveryConfirmationCode: null, pickupCode: null, needsPickupCode: o.type === "rescue" && !!o.pickupCode },
        items: byOrder.get(o.id) ?? [],
      }));
    }),

  updateOrderStatus: authedQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      status: z.string(),
      reason: z.string().trim().max(300).optional(),
      // Código de retiro que el cliente muestra al recoger un rescate
      pickupCode: z.string().regex(/^\d{6}$/, "El código tiene 6 dígitos").optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const db = getDb();
      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, input.orderId), eq(orders.businessId, biz.id)),
      });
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });
      const allowed = BUSINESS_NEXT[order.status] ?? [];
      // Para delivery, el comercio no marca "delivered" (eso es del repartidor)
      const next = input.status as OrderStatus;
      const flow = allowed.filter(() =>
        order.type === "delivery" && next === "delivered" ? false : true,
      );
      if (!flow.includes(next)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No puedes pasar de "${order.status}" a "${next}"`,
        });
      }
      if (next === "cancelled") {
        if (!canBusinessCancel(order.type, order.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido ya no se puede cancelar desde el local" });
        }
        if (order.type === "delivery" && order.courierId != null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Un repartidor ya tomó este pedido y no se puede cancelar desde el local" });
        }
        if (businessCancelNeedsReason(order.status) && (input.reason?.length ?? 0) < MIN_CANCEL_REASON_LENGTH) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indica el motivo de la cancelación (el cliente lo verá)" });
        }
        // Si era un rescate, devuelve el stock del pack. La condición de estado es atómica:
        // si un repartidor lo toma justo ahora, la cancelación falla en vez de pisarlo.
        await cancelOrderAndRestock(order.id, businessCancelableFrom(order.type), { by: "business", reason: input.reason });
        await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "business", type: "cancelled", detail: input.reason });
        await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: "cancelled", type: order.type, reason: input.reason });
        return { ok: true };
      }
      // Entregar un rescate exige el código de retiro del cliente (con límite de intentos).
      if (next === "delivered" && order.type === "rescue" && order.pickupCode) {
        if (!input.pickupCode) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Pide al cliente su código de retiro de 6 dígitos" });
        }
        const [gate] = await db.update(orders)
          .set({ codeAttempts: sql`${orders.codeAttempts} + 1`, updatedAt: order.updatedAt })
          .where(and(eq(orders.id, order.id), eq(orders.status, order.status), lt(orders.codeAttempts, BUSINESS_RULES.maxCodeAttempts)));
        if (gate.affectedRows === 0) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Se agotaron los intentos. El cliente puede generar un código nuevo desde su pedido." });
        }
        if (!codesMatch(order.pickupCode, input.pickupCode)) {
          const [fresh] = await db.select({ attempts: orders.codeAttempts }).from(orders).where(eq(orders.id, order.id)).limit(1);
          const left = Math.max(0, BUSINESS_RULES.maxCodeAttempts - (fresh?.attempts ?? BUSINESS_RULES.maxCodeAttempts));
          if (left === 0) {
            await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "business", type: "code_locked" });
            await sendPushToUser(order.customerId, { title: "Código de retiro bloqueado", body: "Se intentó confirmar tu retiro con un código incorrecto varias veces. Genera un código nuevo desde tu pedido.", orderId: order.id }).catch(() => undefined);
          }
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: left > 0 ? `El código no coincide. Te quedan ${left} intento${left === 1 ? "" : "s"}.` : "El código no coincide y se agotaron los intentos. El cliente debe generar un código nuevo.",
          });
        }
      }
      const [res] = await db.update(orders).set({
        status: next,
        businessReminderSentAt: null,
        ...(next === "ready" ? { readyAt: new Date(), courierReminderSentAt: null } : {}),
        ...(next === "ready" && order.type === "delivery" && !order.courierPickupCode
          ? { courierPickupCode: String(randomInt(100000, 1000000)) }
          : {}),
        ...(next === "delivered" ? { deliveredAt: new Date() } : {}),
      }).where(and(eq(orders.id, order.id), eq(orders.status, order.status))); // evita carreras con cancelaciones
      if (res.affectedRows === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "El pedido cambió de estado. Actualiza la pantalla." });
      await logOrderEvent({ orderId: order.id, actorId: ctx.user.id, actorRole: "business", type: `status:${next}` });
      await notifyOrderStatus({ customerId: order.customerId, orderId: order.id, code: order.code, status: next, type: order.type });
      // Pedido de delivery listo: avisar a los repartidores disponibles
      if (next === "ready" && order.type === "delivery") await notifyCouriersOrderReady(order.id);
      return { ok: true };
    }),

  // --- Productos ---
  products: authedQuery.query(async ({ ctx }) => {
    const biz = await requireMyBusiness(ctx.user.id);
    return getDb()
      .select()
      .from(products)
      .where(eq(products.businessId, biz.id))
      .orderBy(desc(products.createdAt));
  }),

  upsertProduct: authedQuery
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().min(2).max(150),
        description: z.string().max(300).optional(),
        imageUrl: z.string().max(500_000).optional().nullable(),
        price: z.number().min(0.1).max(500),
        emoji: z.string().max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const db = getDb();
      const folder = businessImageFolder(biz.id, "product");
      const finalImageUrl = await promoteStagedImageUrl(input.imageUrl, folder);
      const existing = input.id
        ? await db.query.products.findFirst({ where: and(eq(products.id, input.id), eq(products.businessId, biz.id)) })
        : undefined;
      assertValidImageUrl(finalImageUrl, folder, existing?.imageUrl);
      if (input.id) {
        await db
          .update(products)
          .set({
            name: input.name,
            description: input.description ?? null,
            imageUrl: finalImageUrl ?? null,
            price: input.price,
            emoji: input.emoji ?? "🍽️",
          })
          .where(
            and(eq(products.id, input.id), eq(products.businessId, biz.id)),
          );
        // Si cambió o quitó la foto, borra la anterior del almacenamiento
        await releaseReplacedImage(existing?.imageUrl, finalImageUrl ?? null, folder);
        return { id: input.id };
      }
      const [{ id }] = await db
        .insert(products)
        .values({
          businessId: biz.id,
          name: input.name,
          description: input.description ?? null,
          imageUrl: finalImageUrl ?? null,
          price: input.price,
          emoji: input.emoji ?? "🍽️",
        })
        .$returningId();
      return { id };
    }),

  toggleProduct: authedQuery
    .input(z.object({ id: z.number(), isAvailable: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      await getDb()
        .update(products)
        .set({ isAvailable: input.isAvailable })
        .where(and(eq(products.id, input.id), eq(products.businessId, biz.id)));
      return { ok: true };
    }),

  // --- Packs de rescate ---
  rescuePacks: authedQuery.query(async ({ ctx }) => {
    const biz = await requireMyBusiness(ctx.user.id);
    const rows = await getDb()
      .select()
      .from(rescuePacks)
      .where(eq(rescuePacks.businessId, biz.id))
      .orderBy(desc(rescuePacks.createdAt));
    const now = new Date();
    return rows.map((p) => ({ ...p, expired: isPackExpired(p.expiresAt, now) }));
  }),

  createRescuePack: authedQuery
    .input(
      z.object({
        title: z.string().min(2).max(150),
        description: z.string().max(300).optional(),
        imageUrl: z.string().max(500_000).optional().nullable(),
        originalPrice: z.number().min(0.5).max(500),
        rescuePrice: z.number().min(0.25).max(500),
        quantityTotal: z.number().int().min(1).max(100),
        pickupStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)"),
        pickupEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const packFolder = businessImageFolder(biz.id, "rescue-pack");
      // Primero TODAS las validaciones que no tocan el almacenamiento: si alguna falla, la foto temporal
      // queda intacta (el dueño puede corregir el dato y reintentar sin volver a subirla).
      if (input.rescuePrice >= input.originalPrice) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El precio de rescate debe ser menor al precio original",
        });
      }
      const expiresAt = computePackExpiry(input.pickupStart, input.pickupEnd);
      // La foto se confirma (copia a su carpeta definitiva y borra la temporal) justo antes de guardar.
      const finalImageUrl = await promoteStagedImageUrl(input.imageUrl, packFolder);
      const promoted = Boolean(finalImageUrl) && finalImageUrl !== input.imageUrl;
      try {
        assertValidImageUrl(finalImageUrl, packFolder);
        const [{ id }] = await getDb()
          .insert(rescuePacks)
          .values({
            businessId: biz.id,
            title: input.title,
            description: input.description ?? null,
            imageUrl: finalImageUrl ?? null,
            originalPrice: input.originalPrice,
            rescuePrice: input.rescuePrice,
            quantityTotal: input.quantityTotal,
            quantityLeft: input.quantityTotal,
            pickupStart: input.pickupStart,
            pickupEnd: input.pickupEnd,
            expiresAt,
          })
          .$returningId();
        return { id };
      } catch (error) {
        // Si aun así falla el guardado, no deja una copia definitiva huérfana sin pack que la use.
        if (promoted && finalImageUrl) await deleteStoredImage(finalImageUrl, packFolder);
        throw error;
      }
    }),

  toggleRescuePack: authedQuery
    .input(z.object({ id: z.number().int().positive(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const db = getDb();
      const pack = await db.query.rescuePacks.findFirst({
        where: and(eq(rescuePacks.id, input.id), eq(rescuePacks.businessId, biz.id)),
      });
      if (!pack) throw new TRPCError({ code: "NOT_FOUND", message: "Pack no encontrado" });
      if (input.isActive && isPackExpired(pack.expiresAt)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Este pack venció. Usa «Republicar» para publicarlo de nuevo." });
      }
      await db.update(rescuePacks).set({ isActive: input.isActive }).where(eq(rescuePacks.id, pack.id));
      return { ok: true };
    }),

  // Vuelve a publicar un pack (por ejemplo el de todos los días): nuevo vencimiento y stock repuesto.
  republishRescuePack: authedQuery
    .input(z.object({ id: z.number().int().positive(), quantity: z.number().int().min(1).max(100).optional() }))
    .mutation(async ({ ctx, input }) => {
      const biz = await requireMyBusiness(ctx.user.id);
      const db = getDb();
      const pack = await db.query.rescuePacks.findFirst({
        where: and(eq(rescuePacks.id, input.id), eq(rescuePacks.businessId, biz.id)),
      });
      if (!pack) throw new TRPCError({ code: "NOT_FOUND", message: "Pack no encontrado" });
      const quantity = input.quantity ?? pack.quantityTotal;
      const expiresAt = computePackExpiry(pack.pickupStart, pack.pickupEnd);
      await db
        .update(rescuePacks)
        .set({ expiresAt, quantityTotal: quantity, quantityLeft: quantity, isActive: true })
        .where(eq(rescuePacks.id, pack.id));
      return { ok: true, expiresAt };
    }),

  // Reseñas visibles únicamente para el dueño del comercio autenticado.
  reviews: authedQuery.query(async ({ ctx }) => {
    const biz = await requireMyBusiness(ctx.user.id);
    const rows = await getDb()
      .select({
        id: ratings.id,
        orderId: ratings.orderId,
        businessStars: ratings.businessStars,
        businessComment: ratings.businessComment,
        createdAt: ratings.createdAt,
        customerName: users.name,
      })
      .from(ratings)
      .leftJoin(users, eq(users.id, ratings.customerId))
      .where(eq(ratings.businessId, biz.id))
      .orderBy(desc(ratings.createdAt), desc(ratings.id))
      .limit(100);
    // Al comercio solo se le muestra el primer nombre del cliente (igual que el chat y la tarjeta del repartidor).
    return rows.map((r) => ({ ...r, customerName: r.customerName?.trim().split(/\s+/)[0] || null }));
  }),

  // --- Estadísticas ---
  // Ventas = lo que cobra el local (subtotal de pedidos ENTREGADOS). El envío no cuenta: es del repartidor.
  stats: authedQuery.query(async ({ ctx }) => {
    const biz = await requireMyBusiness(ctx.user.id);
    const db = getDb();
    const startOfDay = startOfDayEcuador();
    const [row] = await db
      .select({
        count: sql<number>`count(*)`,
        delivered: sql<number>`coalesce(sum(case when ${orders.status} = 'delivered' then 1 else 0 end), 0)`,
        sales: sql<number>`coalesce(sum(case when ${orders.status} = 'delivered' then ${orders.subtotal} else 0 end), 0)`,
        rescues: sql<number>`coalesce(sum(case when ${orders.type} = 'rescue' and ${orders.status} != 'cancelled' then 1 else 0 end), 0)`,
        active: sql<number>`coalesce(sum(case when ${orders.status} in ('pending','accepted','preparing','ready') then 1 else 0 end), 0)`,
      })
      .from(orders)
      .where(eq(orders.businessId, biz.id));
    const [today] = await db
      .select({
        delivered: sql<number>`count(*)`,
        sales: sql<number>`coalesce(sum(${orders.subtotal}), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.businessId, biz.id), eq(orders.status, "delivered"), gte(orders.deliveredAt, startOfDay)));
    const [created] = await db
      .select({ count: sql<number>`coalesce(sum(case when ${orders.status} != 'cancelled' then 1 else 0 end), 0)` })
      .from(orders)
      .where(and(eq(orders.businessId, biz.id), gte(orders.createdAt, startOfDay)));
    return {
      totalOrders: Number(row?.count ?? 0),
      deliveredOrders: Number(row?.delivered ?? 0),
      revenue: Number(row?.sales ?? 0), // ventas totales (sin envío), solo entregados
      rescues: Number(row?.rescues ?? 0),
      activeOrders: Number(row?.active ?? 0),
      todayOrders: Number(created?.count ?? 0), // pedidos recibidos hoy (sin cancelados)
      todayDelivered: Number(today?.delivered ?? 0),
      todaySales: Number(today?.sales ?? 0),
      rating: biz.rating,
      ratingCount: biz.ratingCount,
    };
  }),
});
