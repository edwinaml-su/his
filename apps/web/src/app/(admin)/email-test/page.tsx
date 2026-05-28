"use client";

/**
 * /email-test — Diagnóstico SMTP (solo ADMIN/DIRECTOR).
 *
 * Botón que llama POST /api/admin/email/test y muestra:
 *   - providerMessageId si tuvo éxito
 *   - errorClass + hint accionable si falla (ej. "habilita SMTP AUTH",
 *     "necesitas App Password si hay MFA", etc.)
 *
 * Ayuda a IT a validar la configuración SMTP M365 desde la UI sin tener que
 * abrir logs de Vercel ni Supabase.
 */
import * as React from "react";
import { Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Alert, AlertDescription } from "@his/ui/components/alert";

type Result =
  | { ok: true; providerMessageId: string; providerName: string; latencyMs: number }
  | {
      ok: false;
      error: string;
      errorClass: string;
      hint?: string;
      latencyMs?: number;
    };

export default function EmailTestPage() {
  const [to, setTo] = React.useState("");
  const [subject, setSubject] = React.useState("Prueba SMTP — HIS Avante");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject }),
      });
      const json = (await res.json()) as Result;
      setResult(json);
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : "Error de red.",
        errorClass: "NETWORK",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Mail className="h-6 w-6" aria-hidden />
          Diagnóstico SMTP
        </h1>
        <p className="text-sm text-muted-foreground">
          Verifica que el envío de correos desde el HIS hacia Microsoft 365 esté
          funcionando. Solo accesible para ADMIN / DIRECTOR.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enviar email de prueba</CardTitle>
          <CardDescription>
            Llama al endpoint <code>/api/admin/email/test</code> con
            <code> SMTP_HOST/USER/PASS</code> configurado en Vercel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="to">Destinatario</Label>
              <Input
                id="to"
                type="email"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="tu.email@complejoavante.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject">Asunto</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={150}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Enviando…" : "Enviar prueba"}
            </Button>
          </form>

          {result?.ok === true && (
            <Alert className="mt-4 border-green-300 bg-green-50 dark:bg-green-950/40">
              <AlertDescription className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                <div className="text-sm">
                  <p className="font-semibold text-green-800 dark:text-green-200">
                    Email enviado correctamente
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Provider: <code>{result.providerName}</code> · Latencia:{" "}
                    <code>{result.latencyMs}ms</code>
                  </p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    Message ID: <code>{result.providerMessageId}</code>
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {result?.ok === false && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="text-sm">
                  <p className="font-semibold">
                    Falló el envío ({result.errorClass})
                  </p>
                  <p className="mt-1 break-words text-xs">{result.error}</p>
                  {result.hint && (
                    <p className="mt-2 rounded border border-current/30 bg-current/5 p-2 text-xs">
                      <strong>Pista:</strong> {result.hint}
                    </p>
                  )}
                  {typeof result.latencyMs === "number" && (
                    <p className="mt-1 text-xs opacity-80">
                      Latencia hasta el fallo: <code>{result.latencyMs}ms</code>
                    </p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Variables de entorno requeridas</CardTitle>
          <CardDescription>
            En Vercel → Settings → Environment Variables (Production + Preview).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              <tr><td className="py-1.5 pr-3 font-mono text-xs">SMTP_HOST</td><td>smtp.office365.com</td></tr>
              <tr><td className="py-1.5 pr-3 font-mono text-xs">SMTP_PORT</td><td>587</td></tr>
              <tr><td className="py-1.5 pr-3 font-mono text-xs">SMTP_USER</td><td>his@complejoavante.com</td></tr>
              <tr><td className="py-1.5 pr-3 font-mono text-xs">SMTP_PASS</td><td>(contraseña del buzón o App Password)</td></tr>
              <tr><td className="py-1.5 pr-3 font-mono text-xs">SMTP_FROM</td><td>his@complejoavante.com</td></tr>
              <tr><td className="py-1.5 pr-3 font-mono text-xs">SMTP_FROM_NAME</td><td>HIS Avante</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
