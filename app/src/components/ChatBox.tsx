import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { MessageCircle, Send, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { lastMessageId, newPeerMessages, peerInitial, quickReplies, toastPreview } from "@/lib/chat-ui";

/**
 * Chat entre el cliente y el repartidor mientras el pedido va en camino, al estilo de las apps de delivery:
 * un botón de mensaje con contador de no leídos (se coloca arriba, junto al título) que abre el chat en una hoja.
 *  - Con la hoja cerrada avisa en la app cuando llega un mensaje nuevo.
 *  - Trae respuestas rápidas de un toque.
 *  - Cuando el pedido termina, la hoja se cierra sola y el botón desaparece.
 * Se actualiza cada pocos segundos; el aviso push cubre cuando la app está en segundo plano.
 *
 * `ended`: el padre ya sabe que el pedido terminó (así se cierra al instante, sin esperar la siguiente consulta).
 */
export function ChatButton({ orderId, ended = false }: { orderId: number; ended?: boolean }) {
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
  const role = data?.role;
  const live = !!data?.canSend && !ended;
  const unread = role ? messages.filter((m) => m.senderRole !== role && !m.readAt).length : 0;

  // Al terminar el pedido: si la hoja estaba abierta, se cierra sola y se avisa.
  const wasLive = useRef(false);
  useEffect(() => {
    if (live) {
      wasLive.current = true;
      return;
    }
    if (wasLive.current && data) {
      wasLive.current = false;
      if (open) {
        setOpen(false);
        toast.info("El pedido terminó: el chat se cerró.");
      }
    }
  }, [live, data, open]);

  // Aviso dentro de la app cuando llega un mensaje y el chat está cerrado.
  const seenId = useRef<number | null>(null);
  useEffect(() => {
    if (!data || !role) return;
    if (seenId.current === null) {
      seenId.current = lastMessageId(messages); // lo que ya estaba al entrar no se avisa
      return;
    }
    const fresh = newPeerMessages(messages, role, seenId.current);
    seenId.current = Math.max(seenId.current, lastMessageId(messages));
    if (fresh.length > 0 && !open && live) {
      toast(toastPreview(data.peerName, fresh[fresh.length - 1].body), {
        icon: "💬",
        action: { label: "Abrir", onClick: () => setOpen(true) },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, data, role]);

  // Al tener el chat abierto, lo recibido se marca como leído.
  useEffect(() => {
    if (open && unread > 0 && !markRead.isPending) markRead.mutate({ orderId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unread, orderId]);

  // Siempre mostrar lo más reciente.
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, messages.length]);

  if (!data || !role || !live) return null;

  const peer = role === "customer" ? "repartidor" : "cliente";
  const submit = (body = text) => {
    const clean = body.trim();
    if (clean && !send.isPending) send.mutate({ orderId, body: clean });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread > 0 ? `Abrir chat con tu ${peer} (${unread} sin leer)` : `Abrir chat con tu ${peer}`}
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-dark ring-1 ring-brand/20 transition-transform active:scale-90"
      >
        <MessageCircle className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-extrabold text-white ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="fixed bottom-0 left-0 right-0 top-auto flex h-[85dvh] max-h-[85dvh] max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none rounded-t-3xl border-0 p-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:bottom-auto sm:left-[50%] sm:right-auto sm:top-[50%] sm:h-[600px] sm:max-w-md sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-3xl"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-base font-extrabold text-white">
              {peerInitial(data.peerName, role)}
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-display truncate text-base font-extrabold leading-tight">
                {data.peerName ?? `Tu ${peer}`}
              </DialogTitle>
              <DialogDescription className="text-xs font-semibold text-muted-foreground">
                Tu {peer} · pedido en camino
              </DialogDescription>
            </div>
            <DialogClose aria-label="Cerrar chat" className="grid h-9 w-9 place-items-center rounded-full bg-secondary transition-transform active:scale-90">
              <X className="h-4 w-4" />
            </DialogClose>
          </header>

          <p className="shrink-0 bg-amber-50 px-4 py-1.5 text-center text-[11px] font-semibold text-amber-900">
            🔒 No compartas el código de confirmación por aquí: solo se dice en persona al recibir el pedido.
          </p>

          <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-secondary/50 px-4 py-3">
            {messages.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs font-semibold text-muted-foreground">
                Aún no hay mensajes. Escribe para coordinar la entrega (puerta, referencias, demoras…) o usa una respuesta rápida.
              </p>
            ) : (
              messages.map((m) => {
                const mine = m.senderRole === role;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm font-semibold ${mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-card ring-1 ring-border"}`}>
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

          <div className="shrink-0 space-y-2 border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Respuestas rápidas">
              {quickReplies(role).map((reply) => (
                <button
                  key={reply}
                  type="button"
                  disabled={send.isPending}
                  onClick={() => submit(reply)}
                  className="shrink-0 rounded-full bg-secondary px-3.5 py-2 text-xs font-extrabold ring-1 ring-border transition-transform active:scale-95 disabled:opacity-50"
                >
                  {reply}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                maxLength={500}
                enterKeyHint="send"
                aria-label={`Mensaje para tu ${peer}`}
                placeholder={`Escribe a tu ${peer}…`}
                className="min-w-0 flex-1 rounded-full border border-input bg-background px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => submit()}
                disabled={send.isPending || text.trim().length === 0}
                aria-label="Enviar mensaje"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-white transition-transform active:scale-90 disabled:opacity-40"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
