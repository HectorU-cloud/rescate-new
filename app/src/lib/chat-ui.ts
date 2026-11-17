/** Lógica pura de la interfaz del chat (se prueba sin navegador). */

export type ChatRole = "customer" | "courier";

/** Respuestas rápidas de un toque, como en las apps de delivery. */
export const QUICK_REPLIES: Record<ChatRole, string[]> = {
  customer: ["Ya salgo a recibirte", "Estoy en la puerta", "Dame 5 minutos", "Toca el timbre"],
  courier: ["Ya voy en camino", "Ya llegué", "Estoy afuera", "No encuentro la dirección"],
};

export function quickReplies(role: ChatRole): string[] {
  return QUICK_REPLIES[role];
}

type MessageLike = { id: number; senderRole: string; body: string };

/** Mensajes del otro que llegaron después de `afterId` (para avisar cuando el chat está cerrado). */
export function newPeerMessages<T extends MessageLike>(messages: T[], role: ChatRole, afterId: number): T[] {
  return messages.filter((m) => m.id > afterId && m.senderRole !== role);
}

export function lastMessageId(messages: { id: number }[]): number {
  return messages.reduce((max, m) => Math.max(max, m.id), 0);
}

/** Texto corto para el aviso dentro de la app. */
export function toastPreview(name: string | null, body: string, max = 80): string {
  const clean = body.replace(/\s+/g, " ").trim();
  const text = clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  return name ? `${name}: ${text}` : text;
}

/** Inicial para el avatar del otro participante. */
export function peerInitial(name: string | null, role: ChatRole): string {
  const first = name?.trim().charAt(0);
  if (first) return first.toLocaleUpperCase("es");
  return role === "customer" ? "R" : "C";
}
