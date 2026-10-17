import { describe, expect, it } from "vitest";
import { CHAT_RULES, canChatNow, chatPreview, chatRoleFor, containsConfirmationCode } from "./chat-rules";

describe("canChatNow", () => {
  it("solo permite chatear en un delivery en camino con repartidor", () => {
    expect(canChatNow({ type: "delivery", status: "picked_up", courierId: 7 })).toBe(true);
  });
  it("no permite chatear sin repartidor, en otros estados ni en rescates", () => {
    expect(canChatNow({ type: "delivery", status: "picked_up", courierId: null })).toBe(false);
    for (const status of ["pending", "accepted", "preparing", "ready", "delivered", "cancelled"]) {
      expect(canChatNow({ type: "delivery", status, courierId: 7 })).toBe(false);
    }
    expect(canChatNow({ type: "rescue", status: "picked_up", courierId: 7 })).toBe(false);
  });
});

describe("chatRoleFor", () => {
  const order = { customerId: 1, courierId: 2 };
  it("identifica al cliente y al repartidor asignado", () => {
    expect(chatRoleFor(order, 1)).toBe("customer");
    expect(chatRoleFor(order, 2)).toBe("courier");
  });
  it("deja fuera a cualquier otra persona (comercio, terceros, repartidor anterior)", () => {
    expect(chatRoleFor(order, 3)).toBeNull();
    expect(chatRoleFor({ customerId: 1, courierId: null }, 2)).toBeNull();
  });
});

describe("containsConfirmationCode", () => {
  it("detecta el código aunque venga con espacios, guiones o dentro de una frase", () => {
    expect(containsConfirmationCode("mi código es 482913", "482913")).toBe(true);
    expect(containsConfirmationCode("482 913", "482913")).toBe(true);
    expect(containsConfirmationCode("4-8-2-9-1-3", "482913")).toBe(true);
  });
  it("no bloquea mensajes normales ni números cortos", () => {
    expect(containsConfirmationCode("Estoy en la puerta, casa 12", "482913")).toBe(false);
    expect(containsConfirmationCode("Llego en 10 minutos", "482913")).toBe(false);
    expect(containsConfirmationCode("482", "482913")).toBe(false);
  });
  it("no hace nada si el pedido no tiene código", () => {
    expect(containsConfirmationCode("123456", null)).toBe(false);
    expect(containsConfirmationCode("123456", "")).toBe(false);
  });
});

describe("chatPreview", () => {
  it("compacta espacios y saltos de línea", () => {
    expect(chatPreview("  hola \n\n  ya  llegué ")).toBe("hola ya llegué");
  });
  it("recorta los textos largos con puntos suspensivos", () => {
    const out = chatPreview("a".repeat(300));
    expect(out).toHaveLength(CHAT_RULES.previewLength);
    expect(out.endsWith("…")).toBe(true);
  });
  it("no toca los textos cortos", () => {
    expect(chatPreview("ok")).toBe("ok");
  });
});
