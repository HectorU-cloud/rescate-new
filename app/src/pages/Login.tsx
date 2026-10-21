import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Paths } from "@contracts/constants";
import { ArrowLeft, Eye, EyeOff, Mail, Lock, UserRound, Leaf, Sprout } from "lucide-react";

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Cancelaste el inicio de sesión.", state: "La sesión de acceso expiró. Inténtalo de nuevo.",
  token: "Google no aceptó el acceso. Inténtalo de nuevo.", email: "Tu cuenta de Google debe tener el correo verificado.",
  server: "Ocurrió un error al iniciar sesión. Inténtalo de nuevo.", verification: "El enlace de verificación expiró o no es válido. Escribe tu correo y pide uno nuevo con «Reenviar correo de verificación».",
};
function GoogleLogo() { return <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>; }
type Mode = "login" | "register" | "forgot" | "reset";
function FoodIllustration() {
  return <svg viewBox="0 0 320 300" role="img" aria-label="Bolsa con frutas y verduras frescas" className="h-full w-full drop-shadow-sm">
    <ellipse cx="160" cy="265" rx="82" ry="10" fill="#d9d2c4" opacity=".55"/>
    <path d="M111 75 Q98 37 117 17 Q137 44 131 76" fill="#557f3b"/><path d="M143 75 Q135 27 160 7 Q176 43 158 77" fill="#315f36"/><path d="M164 76 Q175 32 199 29 Q198 61 176 83" fill="#789447"/>
    <path d="M116 79 Q91 47 78 60 Q81 86 120 96" fill="#88a84c"/><path d="M188 81 Q206 49 226 64 Q218 91 190 98" fill="#4d7c35"/>
    <circle cx="105" cy="85" r="22" fill="#d94b3d"/><circle cx="137" cy="76" r="20" fill="#e8a42b"/><circle cx="173" cy="78" r="23" fill="#e54f38"/><circle cx="207" cy="88" r="20" fill="#f0b83f"/>
    <path d="M96 110 Q160 91 224 110 L239 242 Q160 263 81 242 Z" fill="#e6cbb2"/><path d="M96 110 Q160 123 224 110 L220 132 Q160 143 91 132 Z" fill="#f2dfcc"/><path d="M105 132 L96 234 M135 137 L132 249 M184 137 L188 250 M215 132 L226 237" stroke="#d5b79c" strokeWidth="2" opacity=".6" fill="none"/>
    <path d="M122 110 Q115 98 126 94 Q160 106 194 94 Q205 99 198 111" fill="#f1ddc8"/>
    <text x="160" y="176" textAnchor="middle" fontSize="28" fontWeight="800" letterSpacing="-1.5" fill="#176b49">rescate</text>
    <path d="M137 188 Q160 198 183 188" stroke="#f18b39" strokeWidth="3" strokeLinecap="round" fill="none"/>
    <text x="160" y="210" textAnchor="middle" fontSize="10" fontWeight="600" fill="#55745b">BUENO PARA TI,</text><text x="160" y="224" textAnchor="middle" fontSize="10" fontWeight="600" fill="#55745b">MEJOR PARA EL PLANETA</text>
  </svg>;
}
export default function Login() {
  const [params] = useSearchParams();
  const initialMode: Mode = params.get("mode") === "reset" && params.get("token") ? "reset" : "login";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [showEmailForm, setShowEmailForm] = useState(initialMode !== "login");
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false); const [busy, setBusy] = useState(false);
  const [showResend, setShowResend] = useState(params.get("error") === "verification");
  const [message, setMessage] = useState(params.get("verified") ? "Correo verificado correctamente. Ya puedes iniciar sesión." : "");
  const [error, setError] = useState(params.get("error") ? ERROR_MESSAGES[params.get("error")!] ?? ERROR_MESSAGES.server : "");
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    if ((mode === "register" || mode === "reset") && password.length < 10) { setError("Usa una contraseña de al menos 10 caracteres."); setBusy(false); return; }
    if (mode === "register" && password !== confirm) { setError("Las contraseñas no coinciden."); setBusy(false); return; }
    try {
      const endpoint = mode === "register" ? "/api/auth/email/register" : mode === "forgot" ? "/api/auth/email/forgot" : mode === "reset" ? "/api/auth/email/reset" : "/api/auth/email/login";
      const body = mode === "register" ? { name, email, password } : mode === "forgot" ? { email } : mode === "reset" ? { token: params.get("token"), password } : { email, password };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) { if (mode === "login" && response.status === 403) setShowResend(true); throw new Error(data.error || "No se pudo completar la solicitud."); }
      if (mode === "login") { window.location.href = "/"; return; }
      setMessage(data.message || "Solicitud completada.");
      if (mode === "register") setShowResend(true);
      if (mode === "register" || mode === "forgot" || mode === "reset") { setPassword(""); setConfirm(""); if (mode === "reset") { setMode("login"); setShowEmailForm(true); } }
    } catch (err) { setError(err instanceof Error ? err.message : "Ocurrió un error. Inténtalo de nuevo."); }
    finally { setBusy(false); }
  }
  async function resend() {
    if (!email.trim()) { setError("Escribe tu correo arriba para reenviar la verificación."); setShowEmailForm(true); return; }
    setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/auth/email/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }), credentials: "same-origin" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudo reenviar el correo."); setMessage(data.message || "Listo. Revisa tu correo."); }
    catch (err) { setError(err instanceof Error ? err.message : "Ocurrió un error. Inténtalo de nuevo."); } finally { setBusy(false); }
  }
  const title = mode === "register" ? "Crea tu cuenta" : mode === "forgot" ? "Recupera tu contraseña" : mode === "reset" ? "Crea una contraseña nueva" : "Qué bueno tenerte aquí";
  const switchMode = (next: Mode) => { setMode(next); setShowEmailForm(true); setError(""); setMessage(""); };
  return <main className="min-h-[100svh] w-full flex items-center justify-center px-5 py-8 sm:py-10" style={{ background: "#fbf8f0" }}>
    <section className="w-full max-w-md animate-slide-up">
      {mode === "login" && !showEmailForm ? <>
        <div className="mx-auto flex h-[270px] max-w-[310px] items-center justify-center sm:h-[300px]"><FoodIllustration /></div>
        <header className="mb-7 mt-1 text-center"><h1 className="text-3xl font-extrabold tracking-tight" style={{ color: "#176b49" }}>Al Rescate</h1><p className="mx-auto mt-2 max-w-xs text-sm leading-6" style={{ color: "#77786d" }}>Rescata comida deliciosa. Ahorra dinero y ayuda al planeta.</p></header>
        <div className="space-y-3">
          <Button type="button" variant="outline" size="lg" className="h-14 w-full rounded-full border-[1.5px] bg-transparent text-[15px] font-medium shadow-none hover:bg-white" style={{ borderColor: "#55584f", color: "#4d5048" }} onClick={() => { window.location.href = Paths.googleLogin; }}><GoogleLogo /> <span className="ml-3">Continuar con Google</span></Button>
          <Button type="button" variant="outline" size="lg" className="h-14 w-full rounded-full border-[1.5px] bg-transparent text-[15px] font-medium shadow-none hover:bg-white" style={{ borderColor: "#55584f", color: "#4d5048" }} onClick={() => { setShowEmailForm(true); setError(""); }}><Mail className="mr-3 h-5 w-5" />Continuar con correo</Button>
        </div>
        <p className="mx-auto mt-6 max-w-xs text-center text-xs leading-5" style={{ color: "#8b8b80" }}>Al continuar, aceptas nuestros <a href="/terminos" className="underline underline-offset-2">Términos de servicio</a> y <a href="/privacidad" className="underline underline-offset-2">Política de privacidad</a>.</p>
        <p className="mt-5 text-center text-sm" style={{ color: "#66685f" }}>¿Primera vez en Rescate? <button type="button" className="font-semibold underline underline-offset-4" style={{ color: "#176b49" }} onClick={() => switchMode("register")}>Crear cuenta</button></p>
      </> : <div className="rounded-[28px] border border-[#e9e3d7] bg-[#fffdf8] p-6 shadow-[0_16px_50px_rgba(48,67,45,0.07)] sm:p-8">
        <button type="button" className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-[#176b49]" onClick={() => { if (mode === "login") setShowEmailForm(false); else switchMode("login"); }}><ArrowLeft className="h-4 w-4"/>Volver</button>
        <div className="mb-6 flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e8f3e9] text-[#176b49]"><Leaf className="h-6 w-6"/></div><div><h1 className="text-2xl font-bold tracking-tight text-[#203c2b]">{title}</h1><p className="mt-1 text-sm text-[#77786d]">{mode === "register" ? "Únete a una forma más consciente de consumir." : mode === "forgot" ? "Te enviaremos instrucciones a tu correo." : mode === "reset" ? "Usa una contraseña segura de al menos 10 caracteres." : "Inicia sesión para continuar."}</p></div></div>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-center text-sm text-red-700">{error}</p>}{message && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-center text-sm text-emerald-800">{message}</p>}
        {mode === "login" && <Button type="button" variant="outline" className="mb-4 h-12 w-full rounded-xl bg-white" onClick={() => { window.location.href = Paths.googleLogin; }}><GoogleLogo/><span className="ml-2">Continuar con Google</span></Button>}
        {mode === "login" && <div className="mb-4 flex items-center gap-3 text-xs text-[#9a9a90]"><span className="h-px flex-1 bg-[#e9e3d7]"/>o con tu correo<span className="h-px flex-1 bg-[#e9e3d7]"/></div>}
        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && <div className="space-y-1.5"><Label htmlFor="name">Nombre completo</Label><div className="relative"><UserRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input id="name" className="h-11 rounded-xl bg-white pl-9" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={255}/></div></div>}
          {mode !== "reset" && <div className="space-y-1.5"><Label htmlFor="email">Correo electrónico</Label><div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input id="email" className="h-11 rounded-xl bg-white pl-9" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={320} placeholder="tu@correo.com"/></div></div>}
          {(mode === "login" || mode === "register" || mode === "reset") && <div className="space-y-1.5"><Label htmlFor="password">{mode === "reset" ? "Nueva contraseña" : "Contraseña"}</Label><div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input id="password" className="h-11 rounded-xl bg-white pl-9 pr-11" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e=>setPassword(e.target.value)} required minLength={mode === "login" ? 1 : 10} maxLength={128}/><button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} className="absolute right-3 top-3 text-muted-foreground" onClick={()=>setShowPassword(!showPassword)}>{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></div></div>}
          {mode === "register" && <div className="space-y-1.5"><Label htmlFor="confirm">Confirmar contraseña</Label><Input id="confirm" className="h-11 rounded-xl bg-white" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={10} maxLength={128}/></div>}
          {mode === "login" && <div className="text-right"><button type="button" className="text-sm font-medium text-[#176b49] hover:underline" onClick={()=>switchMode("forgot")}>¿Olvidaste tu contraseña?</button></div>}
          <Button className="h-12 w-full rounded-xl bg-[#176b49] text-base font-semibold hover:bg-[#12583c]" type="submit" disabled={busy}>{busy ? "Procesando…" : mode === "login" ? "Iniciar sesión" : mode === "register" ? "Crear cuenta" : mode === "forgot" ? "Enviar enlace" : "Guardar contraseña"}</Button>
        </form>
        {showResend && mode !== "forgot" && mode !== "reset" && <button type="button" disabled={busy} onClick={() => void resend()} className="mt-4 w-full text-center text-sm font-medium text-[#176b49] hover:underline disabled:opacity-50">¿No te llegó? Reenviar correo de verificación</button>}
        <div className="mt-5 text-center text-sm text-[#66685f]">{mode === "login" ? <>¿No tienes cuenta? <button className="font-semibold text-[#176b49] hover:underline" onClick={()=>switchMode("register")}>Crear cuenta</button></> : <button className="font-semibold text-[#176b49] hover:underline" onClick={()=>switchMode("login")}>Volver a iniciar sesión</button>}</div>
        {import.meta.env.DEV && <Button asChild variant="ghost" className="mt-3 w-full" size="sm"><a href="/api/dev-login">Entrar como usuario de prueba (solo dev)</a></Button>}
      </div>}
      <div className="mt-7 flex items-center justify-center gap-2 text-xs text-[#8b8b80]"><Sprout className="h-4 w-4 text-[#4f8754]"/>Menos desperdicio, más oportunidades.</div>
    </section>
  </main>;
}
