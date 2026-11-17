import { describe, expect, it } from "vitest";
import { lastMessageId, newPeerMessages, peerInitial, quickReplies, toastPreview } from "@/lib/chat-ui";

const msgs = [
  { id: 1, senderRole: "customer", body: "hola" },
  { id: 2, senderRole: "courier", body: "ya voy" },
  { id: 3, senderRole: "courier", body: "ya llegué" },
];

describe("chat-ui", () => {
  it("cada rol tiene sus respuestas rápidas", () => {
    expect(quickReplies("customer")).toContain("Estoy en la puerta");
    expect(quickReplies("courier")).toContain("Ya llegué");
    expect(quickReplies("customer")).not.toEqual(quickReplies("courier"));
  });
  it("solo avisa de lo que escribió el otro y es más nuevo", () => {
    expect(newPeerMessages(msgs, "customer", 0).map((m) => m.id)).toEqual([2, 3]);
    expect(newPeerMessages(msgs, "customer", 2).map((m) => m.id)).toEqual([3]);
    expect(newPeerMessages(msgs, "courier", 0).map((m) => m.id)).toEqual([1]);
    expect(newPeerMessages([], "customer", 0)).toEqual([]);
  });
  it("lastMessageId", () => {
    expect(lastMessageId(msgs)).toBe(3);
    expect(lastMessageId([])).toBe(0);
  });
  it("toastPreview recorta y antepone el nombre", () => {
    expect(toastPreview("Luis", "  hola   que tal ")).toBe("Luis: hola que tal");
    expect(toastPreview(null, "x".repeat(100))).toHaveLength(80);
    expect(toastPreview(null, "x".repeat(100)).endsWith("…")).toBe(true);
  });
  it("peerInitial usa la primera letra o un respaldo por rol", () => {
    expect(peerInitial("ángel", "customer")).toBe("Á");
    expect(peerInitial(null, "customer")).toBe("R");
    expect(peerInitial("  ", "courier")).toBe("C");
  });
});
