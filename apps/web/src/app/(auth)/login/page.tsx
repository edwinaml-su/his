"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

/** Formatea HH:MM en horario local del navegador para el aviso de lock. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/dashboard";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

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
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Ingresando…" : "Ingresar"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
