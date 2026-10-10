import { useSearchParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Paths } from "@contracts/constants";

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Cancelaste el inicio de sesión.",
  state: "La sesión de acceso expiró. Inténtalo de nuevo.",
  token: "Google no aceptó el acceso. Inténtalo de nuevo.",
  email: "Tu cuenta de Google debe tener el correo verificado.",
  server: "Ocurrió un error al iniciar sesión. Inténtalo de nuevo.",
};

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="mr-2 h-5 w-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const error = params.get("error");

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Bienvenido a Al Rescate</CardTitle>
          <p className="text-sm text-muted-foreground">
            Entra para pedir, rescatar comida o gestionar tu negocio.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p className="rounded-md bg-destructive/10 p-2 text-center text-sm text-destructive">
              {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.server}
            </p>
          )}
          <Button
            className="w-full"
            size="lg"
            variant="outline"
            onClick={() => {
              window.location.href = Paths.googleLogin;
            }}
          >
            <GoogleLogo />
            Continuar con Google
          </Button>
          {import.meta.env.DEV && (
            <Button asChild variant="ghost" className="w-full" size="sm">
              <a href="/api/dev-login">Entrar como usuario de prueba (solo dev)</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
