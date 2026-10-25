import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Reemplazo de window.prompt / window.confirm. Muchos navegadores incrustados (Instagram, Facebook, WhatsApp…)
 * y modo PWA bloquean esos diálogos nativos y devuelven null sin mostrar nada, con lo que el botón "no hace nada".
 * Estos usan el AlertDialog de la app y devuelven una promesa: texto escrito, o null si se cancela.
 */
export type PromptOptions = {
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Texto obligatorio (por defecto sí). Con minLength se exige esa cantidad de caracteres. */
  required?: boolean;
  minLength?: number;
};
export type ConfirmOptions = { title: string; description?: string; confirmLabel?: string; destructive?: boolean };

type Dialogs = {
  prompt: (options: PromptOptions) => Promise<string | null>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const DialogsContext = createContext<Dialogs | null>(null);

type State =
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void }
  | { kind: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void };

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [text, setText] = useState("");
  // Evita resolver dos veces (confirmar y luego el cierre del diálogo).
  const settled = useRef(false);

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        settled.current = false;
        setText("");
        setState({ kind: "prompt", options, resolve });
      }),
    [],
  );
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        settled.current = false;
        setState({ kind: "confirm", options, resolve });
      }),
    [],
  );
  const value = useMemo(() => ({ prompt, confirm }), [prompt, confirm]);

  const close = (result: string | boolean | null) => {
    if (!state || settled.current) return;
    settled.current = true;
    if (state.kind === "prompt") state.resolve(typeof result === "string" ? result : null);
    else state.resolve(result === true);
    setState(null);
  };

  const minLength = state?.kind === "prompt" ? (state.options.minLength ?? (state.options.required === false ? 0 : 1)) : 0;
  const trimmed = text.trim();
  const valid = state?.kind !== "prompt" || trimmed.length >= minLength;

  return (
    <DialogsContext.Provider value={value}>
      {children}
      <AlertDialog open={state !== null} onOpenChange={(open) => { if (!open) close(state?.kind === "prompt" ? null : false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.options.title}</AlertDialogTitle>
            {state?.options.description && <AlertDialogDescription>{state.options.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          {state?.kind === "prompt" && (
            <div className="space-y-1">
              <Textarea
                autoFocus
                value={text}
                maxLength={300}
                rows={3}
                placeholder={state.options.placeholder}
                onChange={(e) => setText(e.target.value)}
              />
              {minLength > 1 && (
                <p className={`text-xs ${valid ? "text-muted-foreground" : "text-destructive"}`}>Mínimo {minLength} caracteres ({trimmed.length}/{minLength})</p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {/* Botón normal (no AlertDialogAction) para controlar cuándo se cierra y no cerrar con texto inválido */}
            <button
              type="button"
              disabled={!valid}
              onClick={() => close(state?.kind === "prompt" ? trimmed : true)}
              className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-semibold text-white disabled:opacity-50 ${
                state?.kind === "confirm" && state.options.destructive === false ? "bg-brand" : "bg-destructive"
              }`}
            >
              {state?.options.confirmLabel ?? "Confirmar"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogsContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error("useDialogs debe usarse dentro de <DialogsProvider>");
  return ctx;
}
