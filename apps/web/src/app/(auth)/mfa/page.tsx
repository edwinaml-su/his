"use client";

/**
 * /mfa — Verificación TOTP post-login.
 *
 * US-2.2 — MFA TOTP obligatorio para roles privilegiados.
 *
 * Flujo:
 *   1. Usuario completó password en /login. Si su rol es ADMIN/PHYSICIAN y
 *      `User.mfaEnabled = true`, el middleware lo redirige aquí (otro equipo
 *      es responsable del middleware — no tocamos `login/page.tsx`).
 *   2. Esta página le pide los 6 dígitos del authenticator. También acepta
 *      un backup code de 8 dígitos vía toggle "Usar código de respaldo".
 *   3. Al verificar OK, redirige a `?redirect=` (default `/dashboard`).
 *
 * UX:
 *   - <TotpInput /> hace auto-submit cuando los 6 dígitos están completos.
 *   - Si falla, limpia el input y reenfoca para reintentar inmediatamente.
 *   - Toggle "Usar código de respaldo" muestra un <input> textual normal
 *     porque los backup codes suelen pegarse desde una nota.
 *
 * NOTA: la página NO consulta el rol del user. Asume que si está aquí es
 * porque el middleware decidió que debía estar. Si el user llega aquí sin
 * tener MFA enrolado, `verifyMfa` devolverá "MFA no enrolado" y mostramos
 * un link a `/mfa/enroll`.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { TotpInput } from "@/components/totp-input";
import { verifyMfa } from "@/app/actions/mfa";

export default function MfaPage() {
  return (
    <React.Suspense fallback={null}>
      <MfaVerifyForm />
    </React.Suspense>
  );
}

function MfaVerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/dashboard";

  const [token, setToken] = React.useState("");
  const [backupMode, setBackupMode] = React.useState(false);
  const [backupCode, setBackupCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = React.useCallback(
    async (raw: string) => {
      setLoading(true);
      setError(null);
      setInfo(null);
      try {
        const result = await verifyMfa({ token: raw });
        if (result.ok) {
          if (result.usedBackupCode) {
            const remaining = result.remainingBackupCodes ?? 0;
            setInfo(
              `Código de respaldo aceptado. Te ${
                remaining === 1 ? "queda" : "quedan"
              } ${remaining} ${remaining === 1 ? "código" : "códigos"} de respaldo.`,
            );
          }
          router.push(redirect);
          router.refresh();
          return;
        }
        setError(result.error ?? "Código incorrecto.");
        setToken("");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Error inesperado al verificar.",
        );
        setToken("");
      } finally {
        setLoading(false);
      }
    },
    [redirect, router],
  );

  const onSubmitBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{8}$/.test(backupCode.trim())) {
      setError("El código de respaldo debe tener 8 dígitos.");
      return;
    }
    await submit(backupCode.trim());
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verificación en dos pasos</CardTitle>
        <CardDescription>
          {backupMode
            ? "Ingresa uno de tus códigos de respaldo de 8 dígitos."
            : "Ingresa el código de 6 dígitos de tu app autenticadora."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {!backupMode ? (
          <div className="space-y-2">
            <Label htmlFor="totp-0">Código de 6 dígitos</Label>
            <TotpInput
              id="totp-0"
              value={token}
              onChange={setToken}
              onComplete={submit}
              disabled={loading}
              invalid={Boolean(error)}
            />
          </div>
        ) : (
          <form onSubmit={onSubmitBackup} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="backup">Código de respaldo</Label>
              <Input
                id="backup"
                inputMode="numeric"
                autoComplete="off"
                placeholder="12345678"
                maxLength={8}
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value.replace(/\D/g, ""))}
                disabled={loading}
                aria-invalid={Boolean(error) || undefined}
              />
            </div>
            <Button type="submit" disabled={loading || backupCode.length !== 8}>
              {loading ? "Verificando…" : "Verificar"}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2 text-sm">
        <button
          type="button"
          className="text-primary underline-offset-4 hover:underline"
          onClick={() => {
            setBackupMode((m) => !m);
            setError(null);
            setToken("");
            setBackupCode("");
          }}
        >
          {backupMode
            ? "Volver a usar la app autenticadora"
            : "Usar un código de respaldo"}
        </button>
        <Link
          href="/mfa/enroll"
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          ¿Aún no enrolaste tu app? Enrolar ahora
        </Link>
      </CardFooter>
    </Card>
  );
}
