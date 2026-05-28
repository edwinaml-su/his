"use client";

/**
 * /recover/reset — el usuario llega aquí desde el enlace del email.
 *
 * Supabase Auth procesa automáticamente el token del query string en el
 * cliente browser (callback de `onAuthStateChange` con event="PASSWORD_RECOVERY")
 * y queda en una sesión transitoria que SOLO permite `updateUser({ password })`.
 *
 * Si el usuario llega aquí sin token válido (link expirado, copy/paste roto),
 * mostramos un mensaje claro con CTA a "Solicitar nuevo enlace".
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Alert, AlertDescription } from "@his/ui/components/alert";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 12;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Supabase emite event="PASSWORD_RECOVERY" cuando llega aquí con token
  // válido. Nos suscribimos para detectar si el enlace está vivo.
  const [recoveryReady, setRecoveryReady] = React.useState(false);

  React.useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    // Si ya hay sesión de PASSWORD_RECOVERY (porque Supabase la procesó antes
    // de montar este componente), getSession devolverá la session.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setRecoveryReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      );
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.updateUser({ password });

    if (err) {
      setLoading(false);
      setError(err.message);
      return;
    }

    // Cerramos la sesión transitoria de recovery y mandamos al login con
    // el flag que activa el banner verde "Contraseña actualizada".
    await supabase.auth.signOut();
    router.replace("/login?recovered=true");
    router.refresh();
  }

  if (!recoveryReady) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Enlace inválido o expirado</CardTitle>
          <CardDescription>
            Este enlace de recuperación no es válido o ya expiró. Solicita uno
            nuevo desde la página de recuperación.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/recover">Solicitar nuevo enlace</Link>
          </Button>
          <Link
            href="/login"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-3 w-3" aria-hidden />
            Volver al inicio de sesión
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva contraseña</CardTitle>
        <CardDescription>
          Define una nueva contraseña para tu cuenta HIS. Mínimo{" "}
          {MIN_PASSWORD_LENGTH} caracteres.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="password">Nueva contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={show}
                tabIndex={-1}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
              >
                {show ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirmar contraseña</Label>
            <Input
              id="confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Guardando…" : "Guardar nueva contraseña"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
