"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@his/ui/components/card";
import { Alert, AlertDescription } from "@his/ui/components/alert";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAccountLocked, recordLoginAttempt } from "@/app/actions/login-policy";

// Wrapper exigido por Next.js 14: todo componente cliente que usa
// useSearchParams() debe estar dentro de un <Suspense> para permitir
// static rendering. Sin esto, `next build` falla con
// "useSearchParams() should be wrapped in a suspense boundary".
export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

/** Umbral en el que mostramos el warning "te quedan N intentos". */
const LOW_ATTEMPTS_WARNING_THRESHOLD = 2;

/** Feature flag para mostrar el botón "Iniciar con Microsoft". Por default ON
 *  porque el provider ya está configurado en Supabase; el flag permite
 *  desactivarlo temporal sin redeploy si surge incidente. */
const MICROSOFT_LOGIN_ENABLED =
  (process.env.NEXT_PUBLIC_AUTH_MICROSOFT_ENABLED ?? "true").toLowerCase() !== "false";

/** Formatea HH:MM en horario local del navegador para el aviso de lock. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Mapea los códigos de error que devuelve /sso/callback a mensajes ES-SV. */
function mapCallbackError(code: string, email: string | null, description: string | null): string {
  switch (code) {
    case "not_authorized":
      return email
        ? `La cuenta ${email} no está registrada en el HIS. Solicita al administrador que la dé de alta antes de iniciar sesión con Microsoft.`
        : "Tu cuenta Microsoft no está registrada en el HIS. Solicita al administrador que la dé de alta.";
    case "account_inactive":
      return email
        ? `La cuenta ${email} está inactiva. Contacta al administrador.`
        : "Tu cuenta HIS está inactiva. Contacta al administrador.";
    case "missing_email":
      return "Microsoft no devolvió un email. Verifica que tu cuenta tenga email principal configurado.";
    case "unsupported_provider":
      return "Proveedor de inicio de sesión no soportado.";
    case "exchange_failed":
      return description
        ? `No pudimos completar el login con Microsoft: ${description}`
        : "No pudimos completar el login con Microsoft. Reintenta.";
    case "invalid_callback":
      return "Callback de inicio de sesión inválido.";
    default:
      return description ?? `Error de inicio de sesión: ${code}`;
  }
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/dashboard";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  // Inicializamos `error` con el código que venga del callback OAuth, para
  // que el usuario vea por qué fue rechazado al volver a /login.
  const callbackError = params.get("error");
  const callbackEmail = params.get("email");
  const callbackErrorDescription = params.get("error_description");
  const recovered = params.get("recovered") === "true";
  const [error, setError] = React.useState<string | null>(
    callbackError
      ? mapCallbackError(callbackError, callbackEmail, callbackErrorDescription)
      : null,
  );
  const [success, setSuccess] = React.useState<string | null>(
    recovered ? "Contraseña actualizada. Inicia sesión con la nueva." : null,
  );
  const [warning, setWarning] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [msLoading, setMsLoading] = React.useState(false);

  /** Inicia el flow OAuth con Microsoft Azure AD via Supabase Auth. */
  const onMicrosoftSignIn = async () => {
    setMsLoading(true);
    setError(null);
    setWarning(null);
    const supabase = createSupabaseBrowserClient();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const next = encodeURIComponent(redirect);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${origin}/sso/callback?next=${next}`,
        scopes: "email profile openid offline_access",
      },
    });
    if (err) {
      setError(`No pudimos iniciar el flujo con Microsoft: ${err.message}`);
      setMsLoading(false);
    }
    // Si no hubo error, el navegador ya está siendo redirigido a Microsoft.
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setWarning(null);

    // 1) Pre-check: si la cuenta está bloqueada localmente, no gastamos
    //    request a Supabase (y evitamos que un atacante use el endpoint
    //    de auth para timing).
    try {
      const lockStatus = await isAccountLocked(email);
      if (lockStatus.locked && lockStatus.until && lockStatus.minutesLeft) {
        setError(
          `Cuenta bloqueada hasta las ${formatTime(lockStatus.until)}. ` +
            `Intenta de nuevo en ${lockStatus.minutesLeft} ` +
            `${lockStatus.minutesLeft === 1 ? "minuto" : "minutos"}.`,
        );
        setLoading(false);
        return;
      }
    } catch {
      // Si la consulta de policy falla, NO bloqueamos el login: degradamos
      // graciosamente y dejamos que Supabase decida. La auditoría/logging
      // del backend recogerá el incidente.
    }

    // 2) Intento real contra Supabase.
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });

    // 3) Registrar el resultado para mantener contadores. Best-effort.
    let attemptResult: Awaited<ReturnType<typeof recordLoginAttempt>> = {};
    try {
      attemptResult = await recordLoginAttempt(email, !err);
    } catch {
      // ignoramos: la UX no debe romperse por un fallo de telemetría
    }

    setLoading(false);

    if (err) {
      // Prioridad de mensaje: lock recién disparado > error Supabase + warning.
      if (attemptResult.locked && attemptResult.until) {
        setError(
          `Has superado el número de intentos. Cuenta bloqueada hasta las ` +
            `${formatTime(attemptResult.until)} (15 minutos).`,
        );
      } else {
        setError(err.message);
        if (
          typeof attemptResult.remainingAttempts === "number" &&
          attemptResult.remainingAttempts > 0 &&
          attemptResult.remainingAttempts <= LOW_ATTEMPTS_WARNING_THRESHOLD
        ) {
          setWarning(
            `Te ${attemptResult.remainingAttempts === 1 ? "queda" : "quedan"} ` +
              `${attemptResult.remainingAttempts} ` +
              `${attemptResult.remainingAttempts === 1 ? "intento" : "intentos"} ` +
              `antes del bloqueo de 15 min.`,
          );
        }
      }
      return;
    }

    router.replace(redirect);
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>HIS Avante</CardTitle>
        <CardDescription>Inicia sesión con tu cuenta institucional.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {warning && !error && (
            <Alert>
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          )}
          {success && !error && (
            <Alert>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Link
                href="/recover"
                className="text-xs font-medium text-primary hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={showPassword}
                tabIndex={-1}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading || msLoading}>
            {loading ? "Ingresando…" : "Ingresar"}
          </Button>

          {MICROSOFT_LOGIN_ENABLED && (
            <>
              <div
                className="flex w-full items-center gap-2 text-xs text-muted-foreground"
                aria-hidden
              >
                <span className="h-px flex-1 bg-border" />
                <span>o</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={onMicrosoftSignIn}
                disabled={loading || msLoading}
                aria-label="Iniciar sesión con Microsoft 365 corporativo"
              >
                {/* Logo Microsoft (4 cuadros) — SVG inline para no traer libs. */}
                <svg
                  className="mr-2 h-4 w-4"
                  viewBox="0 0 23 23"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                >
                  <rect x="1"  y="1"  width="10" height="10" fill="#F25022" />
                  <rect x="12" y="1"  width="10" height="10" fill="#7FBA00" />
                  <rect x="1"  y="12" width="10" height="10" fill="#00A4EF" />
                  <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
                </svg>
                {msLoading ? "Redirigiendo…" : "Iniciar sesión con Microsoft"}
              </Button>
            </>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
