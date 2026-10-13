import { z } from "zod";
import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { notifyChatMessage } from "./lib/push-notifications";
import { CHAT_RULES, canChatNow, chatRoleFor, containsConfirmationCode } from "./lib/chat-rules";
import { orderMessages, orders, users } from "@db/schema";

const DENIED = "No puedes acceder al chat de este pedido";

/** Carga el pedido y el rol de la persona. Solo el cliente y el repartidor asignado participan. */
async function loadChat(orderId: number, userId: number) {
  const order = await getDb().query.orders.findFirst({ where: eq(orders.id, orderId) });
  const role = order && order.type === "delivery" ? chatRoleFor(order, userId) : null;
  if (!order || !role) throw new TRPCError({ code: "FORBIDDEN", message: DENIED });
  return { order, role };
}

export const chatRouter = createRouter({
  // Mensajes de la conversación actual (los últimos 100) + si todavía se puede escribir.
  list: authedQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const { order, role } = await loadChat(input.orderId, ctx.user.id);
      // Sin repartidor asignado no hay conversación todavía.
      if (order.courierId == null) return { role, canSend: false, peerName: null as string | null, messages: [] };

      const rows = await db
        .select()
        .from(orderMessages)
        .where(and(eq(orderMessages.orderId, order.id), eq(orderMessages.courierId, order.courierId)))
        .orderBy(desc(orderMessages.id))
        .limit(100);

      let peerName: string | null;
      if (role === "customer") {
        const [courier] = await db.select({ name: users.name }).from(users).where(eq(users.id, order.courierId)).limit(1);
        peerName = courier?.name?.trim().split(/\s+/)[0] ?? null; // solo el primer nombre
      } else {
        peerName = order.customerName?.trim().split(/\s+/)[0] ?? null;
      }

      return {
        role,
        canSend: canChatNow(order),
        peerName,
        messages: rows.reverse().map((m) => ({
          id: m.id,
          senderRole: m.senderRole,
          body: m.body,
          createdAt: m.createdAt,
          readAt: m.readAt,
        })),
      };
    }),

  send: authedQuery
    .input(z.object({
      orderId: z.number().int().positive(),
      body: z.string().trim().min(1, "Escribe un mensaje").max(CHAT_RULES.maxLength),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { order, role } = await loadChat(input.orderId, ctx.user.id);
      if (!canChatNow(order) || order.courierId == null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El chat está disponible solo mientras el pedido va en camino" });
      }
      // El código de confirmación solo se dice en persona: si alguien lo escribe en el chat,
      // el repartidor podría "entregar" sin estar presente.
      if (containsConfirmationCode(input.body, order.deliveryConfirmationCode)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Por seguridad no compartas el código de confirmación por el chat. Díselo al repartidor en persona." });
      }
      const [recent] = await db
        .select({ n: sql<number>`count(*)` })
        .from(orderMessages)
        .where(and(
          eq(orderMessages.orderId, order.id),
          eq(orderMessages.senderId, ctx.user.id),
          gte(orderMessages.createdAt, new Date(Date.now() - 60_000)),
        ));
      if (Number(recent?.n ?? 0) >= CHAT_RULES.maxPerMinute) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Estás enviando mensajes muy rápido. Espera un momento." });
      }

      await db.insert(orderMessages).values({
        orderId: order.id,
        courierId: order.courierId,
        senderId: ctx.user.id,
        senderRole: role,
        body: input.body,
      });

      // Push al otro participante, sin hacer esperar a quien escribe.
      void notifyChatMessage({
        recipientId: role === "customer" ? order.courierId : order.customerId,
        orderId: order.id,
        fromRole: role,
        senderName: ctx.user.name,
        body: input.body,
      });
      return { ok: true };
    }),

  // Marca como leídos los mensajes que recibí en este pedido.
  markRead: authedQuery
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { order } = await loadChat(input.orderId, ctx.user.id);
      if (order.courierId == null) return { ok: true };
      await getDb()
        .update(orderMessages)
        .set({ readAt: new Date() })
        .where(and(
          eq(orderMessages.orderId, order.id),
          eq(orderMessages.courierId, order.courierId),
          ne(orderMessages.senderId, ctx.user.id),
          isNull(orderMessages.readAt),
        ));
      return { ok: true };
    }),
});
