"use client";

/**
 * /recover — solicitar enlace de recuperación de contraseña.
 *
 * Solo aplica a usuarios que entran por email/password (no Microsoft). Llama
 * `supabase.auth.resetPasswordForEmail(email, { redirectTo })`. Supabase envía
 * un email con un enlace mágico que cae en `/recover/reset?code=...` donde el
 * usuario define su nueva contraseña.
 *
 * No-leak: el mensaje de éxito es el mismo exista o no la cuenta — así no se
 * usa este endpoint para enumerar emails válidos del personal.
 *
 * Pre-requisito operativo: el SMTP de Supabase debe estar configurado
 * (Dashboard → Authentication → SMTP). Sin SMTP, Supabase usa su sender de
 * cortesía con rate-limit bajo. El template del email también es
 * personalizable allí mismo.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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

export default function RecoverPage() {
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error: err } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${origin}/recover/reset` },
    );

    setLoading(false);

    if (err) {
      // No-leak: solo mostramos errores de transporte (red, SMTP no
      // configurado). Si el email no existe, Supabase NO lo dice y nosotros
      // tampoco — mostramos el mismo mensaje de éxito.
      setError(`No se pudo enviar el enlace: ${err.message}`);
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Revisa tu correo</CardTitle>
          <CardDescription>
            Si la cuenta existe, te enviamos un enlace para restablecer tu
            contraseña. El enlace expira en 1 hora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              No olvides revisar la carpeta de spam o promociones si no lo ves
              en tu bandeja principal.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setSent(false);
              setEmail("");
            }}
          >
            Enviar a otro correo
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
        <CardTitle>Recuperar contraseña</CardTitle>
        <CardDescription>
          Ingresa el correo de tu cuenta HIS y te enviaremos un enlace para
          definir una nueva contraseña.
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
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu.usuario@complejoavante.com"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            ¿Inicias sesión con tu cuenta Microsoft? Esta opción no aplica —
            tu contraseña se administra desde Microsoft 365.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Enviando…" : "Enviar enlace de recuperación"}
          </Button>
          <Link
            href="/login"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-3 w-3" aria-hidden />
            Volver al inicio de sesión
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
