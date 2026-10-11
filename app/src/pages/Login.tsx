import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Paths } from "@contracts/constants";
import { Eye, EyeOff, Mail, Lock, UserRound } from "lucide-react";

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Cancelaste el inicio de sesión.", state: "La sesión de acceso expiró. Inténtalo de nuevo.",
  token: "Google no aceptó el acceso. Inténtalo de nuevo.", email: "Tu cuenta de Google debe tener el correo verificado.",
  server: "Ocurrió un error al iniciar sesión. Inténtalo de nuevo.", verification: "El enlace de verificación expiró o no es válido. Regístrate de nuevo o solicita ayuda.",
};
function GoogleLogo() { return <svg viewBox="0 0 48 48" className="mr-2 h-5 w-5" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg> }
type Mode = "login" | "register" | "forgot" | "reset";
export default function Login() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "reset" && params.get("token") ? "reset" : "login");
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(params.get("verified") ? "Correo verificado correctamente. Ya puedes iniciar sesión." : "");
  const [error, setError] = useState(params.get("error") ? ERROR_MESSAGES[params.get("error")!] ?? ERROR_MESSAGES.server : "");
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    if (mode === "register" && password !== confirm) { setError("Las contraseñas no coinciden."); setBusy(false); return; }
    try {
      const endpoint = mode === "register" ? "/api/auth/email/register" : mode === "forgot" ? "/api/auth/email/forgot" : mode === "reset" ? "/api/auth/email/reset" : "/api/auth/email/login";
      const body = mode === "register" ? { name, email, password } : mode === "forgot" ? { email } : mode === "reset" ? { token: params.get("token"), password } : { email, password };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo completar la solicitud.");
      if (mode === "login") { window.location.href = "/"; return; }
      setMessage(data.message || "Solicitud completada.");
      if (mode === "register" || mode === "forgot" || mode === "reset") { setPassword(""); setConfirm(""); if (mode === "reset") setMode("login"); }
    } catch (err) { setError(err instanceof Error ? err.message : "Ocurrió un error. Inténtalo de nuevo."); }
    finally { setBusy(false); }
  }
  const title = mode === "register" ? "Crea tu cuenta" : mode === "forgot" ? "Recupera tu contraseña" : mode === "reset" ? "Crea una contraseña nueva" : "Bienvenido a Al Rescate";
  return <div className="min-h-screen flex items-center justify-center p-4"><Card className="w-full max-w-sm"><CardHeader className="text-center"><CardTitle>{title}</CardTitle><p className="text-sm text-muted-foreground">{mode === "register" ? "Únete para rescatar comida y reducir el desperdicio." : mode === "forgot" ? "Te enviaremos instrucciones a tu correo." : mode === "reset" ? "Usa una contraseña segura de al menos 10 caracteres." : "Entra para pedir, rescatar comida o gestionar tu negocio."}</p></CardHeader><CardContent className="space-y-4">
    {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-center text-sm text-destructive">{error}</p>}{message && <p role="status" className="rounded-md bg-emerald-600/10 p-2 text-center text-sm">{message}</p>}
    {mode !== "forgot" && mode !== "reset" && <Button className="w-full" size="lg" variant="outline" onClick={() => { window.location.href = Paths.googleLogin; }}><GoogleLogo />Continuar con Google</Button>}
    {mode !== "forgot" && mode !== "reset" && <div className="relative py-1 text-center text-xs text-muted-foreground"><span className="bg-card px-2">o continúa con correo</span></div>}
    <form onSubmit={submit} className="space-y-3">
      {mode === "register" && <div className="space-y-1"><Label htmlFor="name">Nombre completo</Label><div className="relative"><UserRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input id="name" className="pl-9" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={255}/></div></div>}
      {mode !== "reset" && <div className="space-y-1"><Label htmlFor="email">Correo electrónico</Label><div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input id="email" className="pl-9" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={320}/></div></div>}
      {(mode === "login" || mode === "register" || mode === "reset") && <div className="space-y-1"><Label htmlFor="password">{mode === "reset" ? "Nueva contraseña" : "Contraseña"}</Label><div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input id="password" className="pl-9 pr-10" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e=>setPassword(e.target.value)} required minLength={10} maxLength={128}/><button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} className="absolute right-3 top-2.5 text-muted-foreground" onClick={()=>setShowPassword(!showPassword)}>{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></div></div>}
      {mode === "register" && <div className="space-y-1"><Label htmlFor="confirm">Confirmar contraseña</Label><Input id="confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={10} maxLength={128}/></div>}
      {mode === "login" && <div className="text-right"><button type="button" className="text-sm text-primary hover:underline" onClick={()=>{setMode("forgot");setError("");setMessage("")}}>¿Olvidaste tu contraseña?</button></div>}
      <Button className="w-full" size="lg" type="submit" disabled={busy}>{busy ? "Procesando…" : mode === "login" ? "Iniciar sesión" : mode === "register" ? "Crear cuenta" : mode === "forgot" ? "Enviar enlace" : "Guardar contraseña"}</Button>
    </form>
    <div className="text-center text-sm">{mode === "login" ? <>¿No tienes cuenta? <button className="font-medium text-primary hover:underline" onClick={()=>{setMode("register");setError("");setMessage("")}}>Crear cuenta</button></> : <button className="font-medium text-primary hover:underline" onClick={()=>{setMode("login");setError("");setMessage("")}}>Volver a iniciar sesión</button>}</div>
    {import.meta.env.DEV && <Button asChild variant="ghost" className="w-full" size="sm"><a href="/api/dev-login">Entrar como usuario de prueba (solo dev)</a></Button>}
  </CardContent></Card></div>;
}
