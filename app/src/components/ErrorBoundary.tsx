import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/monitoring";

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Si un componente falla al dibujarse, en vez de una pantalla en blanco se muestra un aviso y se reporta el error. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { source: "react", component: info.componentStack?.split("\n")[1]?.trim() });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-[100svh] place-items-center bg-[#fbf8f0] px-5 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-4xl">😕</p>
          <h1 className="font-display text-xl font-extrabold">Algo salió mal</h1>
          <p className="text-sm text-muted-foreground">Ya registramos el problema. Recarga la página para continuar.</p>
          <button onClick={() => window.location.reload()} className="rounded-xl bg-[#176b49] px-5 py-2.5 text-sm font-extrabold text-white">
            Recargar
          </button>
        </div>
      </main>
    );
  }
}
