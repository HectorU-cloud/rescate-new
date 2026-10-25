import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { LEGAL } from "@/lib/legal";

export function ContactLine() {
  if (LEGAL.email) return <a href={`mailto:${LEGAL.email}`} className="font-bold underline underline-offset-2">{LEGAL.email}</a>;
  return <span className="font-bold">el correo de contacto del servicio</span>;
}

export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-[100svh] bg-[#fbf8f0] px-5 py-8">
      <article className="mx-auto max-w-2xl space-y-5 text-sm leading-6 text-foreground/85 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-extrabold [&_h2]:text-foreground [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#176b49]">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
        <p className="text-xs text-muted-foreground">Última actualización: {LEGAL.updated}</p>
        {children}
      </article>
    </main>
  );
}
