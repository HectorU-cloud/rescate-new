import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";

/**
 * Chat entre el cliente y el repartidor mientras el pedido va en camino.
 * Se actualiza solo cada pocos segundos; el aviso push cubre cuando la app está en segundo plano.
 * Cuando el pedido termina queda como historial de solo lectura (y no se muestra si nunca hubo mensajes).
 */
export function ChatBox({ orderId }: { orderId: number }) {
  const utils = trpc.useUtils();
  const location = useLocation();
  // Si llegaron desde la notificación (/pedido/ID#chat), el chat se abre solo.
  const [open, setOpen] = useState(location.hash === "#chat");
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const chat = trpc.chat.list.useQuery(
    { orderId },
    { refetchInterval: (q) => (q.state.data?.canSend ? 4_000 : false), retry: false },
  );
  const markRead = trpc.chat.markRead.useMutation({
    onSuccess: () => utils.chat.list.invalidate({ orderId }),
  });
  const send = trpc.chat.send.useMutation({
    onSuccess: () => {
      setText("");
      utils.chat.list.invalidate({ orderId });
    },
    onError: (e) => toast.error(e.message),
  });

  const data = chat.data;
  const messages = data?.messages ?? [];
  const unread = messages.filter((m) => m.senderRole !== data?.role && !m.readAt).length;

  // Al tener el chat abierto, lo recibido se marca como leído.
  useEffect(() => {
    if (open && unread > 0 && !markRead.isPending) markRead.mutate({ orderId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unread, orderId]);

  // Siempre mostrar lo más reciente.
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, messages.length]);

  if (!data || (!data.canSend && messages.length === 0)) return null;

  const peer = data.role === "customer" ? "repartidor" : "cliente";
  const submit = () => {
    const body = text.trim();
    if (body && !send.isPending) send.mutate({ orderId, body });
  };

  return (
    <section id="chat" className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="text-sm font-extrabold">
          💬 Chat con tu {peer}
          {data.peerName ? ` (${data.peerName})` : ""}
        </span>
        <span className="flex items-center gap-2">
          {unread > 0 && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-extrabold text-white">{unread} nuevo{unread > 1 ? "s" : ""}</span>
          )}
          <span className="text-xs font-bold text-muted-foreground">{open ? "Ocultar" : "Abrir"}</span>
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div ref={listRef} className="max-h-72 space-y-2 overflow-y-auto rounded-2xl bg-secondary p-3">
            {messages.length === 0 ? (
              <p className="py-4 text-center text-xs font-semibold text-muted-foreground">
                Aún no hay mensajes. Escribe para coordinar la entrega (puerta, referencias, demoras…).
              </p>
            ) : (
              messages.map((m) => {
                const mine = m.senderRole === data.role;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm font-semibold ${mine ? "bg-brand text-white" : "bg-card ring-1 ring-border"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`mt-0.5 text-right text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {mine && m.readAt ? " · ✓ visto" : ""}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {data.canSend ? (
            <>
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                  maxLength={500}
                  placeholder={`Escribe a tu ${peer}…`}
                  className="min-w-0 flex-1 rounded-xl border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={submit}
                  disabled={send.isPending || text.trim().length === 0}
                  className="rounded-xl bg-foreground px-4 text-sm font-extrabold text-white disabled:opacity-50"
                >
                  Enviar
                </button>
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground">
                🔒 No compartas el código de confirmación por aquí: solo se dice en persona al recibir el pedido.
              </p>
            </>
          ) : (
            <p className="text-center text-[11px] font-bold text-muted-foreground">El chat se cerró porque el pedido ya terminó.</p>
          )}
        </div>
      )}
    </section>
  );
}
