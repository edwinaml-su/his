"use client";

/**
 * /mfa/enroll — Enrolamiento manual de TOTP desde el dashboard del usuario.
 *
 * US-2.2 — MFA TOTP obligatorio para roles privilegiados.
 *
 * Flujo:
 *   1. Usuario hace click en "Activar MFA" en su perfil → llega aquí.
 *   2. La página llama `enrollMfa()` (Server Action) y obtiene:
 *        - `secret` (base32, 32 chars) — para escaneo manual.
 *        - `otpauthUri` — el QR estándar de Google Authenticator.
 *        - `backupCodes` (10 × 8 dígitos) — para guardar en lugar seguro.
 *   3. Usuario escanea o copia el secret a su app, ingresa el primer
 *      código de 6 dígitos y la página llama `verifyMfa()`.
 *   4. Si verifica OK, redirige al dashboard con mensaje de éxito.
 *
 * QR:
 *   - `qrcode-svg` no está instalado y NO podemos `npm install` (regla del
 *     equipo). Renderizamos el `otpauthUri` como texto seleccionable +
 *     instrucciones de "agregar manualmente". La mayoría de las apps
 *     (Google Authenticator, Authy, 1Password) aceptan pegado de URI.
 *   - TODO(Sprint 2): instalar `qrcode-svg` o `qr-code-styling` y
 *     renderizar el SVG inline. La firma del Server Action ya devuelve
 *     `otpauthUri`, así que sustituirlo será una sola línea.
 *
 * Backup codes:
 *   - Se muestran UNA SOLA VEZ. Botón "Copiar todos" al portapapeles.
 *   - Botón "Descargar como .txt" para que el usuario los guarde fuera de
 *     la web.
 *
 * Seguridad:
 *   - El componente NO persiste secret ni codes en localStorage. Si el
 *     usuario refresca la página antes de confirmar, debe reenrolarse
 *     (Server Action genera un secret nuevo).
 *   - El verify exige el primer código antes de declarar el enrolamiento
 *     completo (DoR Avante).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
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
import { enrollMfa, verifyMfa } from "@/app/actions/mfa";

// Tipo espejo del Server Action. No importamos de @his/contracts porque su
// barrel (schemas/index.ts) está congelado en Sprint 1 (otro equipo lo toca).
type TotpEnrollResult = {
  secret: string;
  otpauthUri: string;
  backupCodes: string[];
};

type Stage = "idle" | "enrolling" | "showing" | "verifying" | "done";

export default function MfaEnrollPage() {
  const router = useRouter();
  const [stage, setStage] = React.useState<Stage>("idle");
  const [data, setData] = React.useState<TotpEnrollResult | null>(null);
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const startEnroll = async () => {
    setStage("enrolling");
    setError(null);
    setInfo(null);
    try {
      const result = await enrollMfa();
      if (!result.ok) {
        setError(result.error);
        setStage("idle");
        return;
      }
      setData(result.data);
      setStage("showing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
      setStage("idle");
    }
  };

  const submitVerify = async (raw: string) => {
    setStage("verifying");
    setError(null);
    try {
      const result = await verifyMfa({ token: raw });
      if (!result.ok) {
        setError(result.error ?? "Código incorrecto.");
        setStage("showing");
        setToken("");
        return;
      }
      setStage("done");
      setInfo("MFA activado correctamente.");
      // Pequeña espera para que el usuario lea el mensaje, luego redirige.
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado al verificar.");
      setStage("showing");
      setToken("");
    }
  };

  // ---- Render por etapa ----------------------------------------------------

  if (stage === "idle" || stage === "enrolling") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activar verificación en dos pasos</CardTitle>
          <CardDescription>
            Necesitas una app autenticadora (Google Authenticator, Authy,
            1Password). Generaremos un secret único y 10 códigos de respaldo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button onClick={startEnroll} disabled={stage === "enrolling"}>
            {stage === "enrolling" ? "Generando…" : "Comenzar enrolamiento"}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  if (stage === "done") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>MFA activado</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              {info ?? "Tu cuenta está protegida con verificación en dos pasos."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // stage = showing | verifying
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configura tu app autenticadora</CardTitle>
        <CardDescription>
          Agrega esta cuenta a tu app y luego ingresa el primer código de 6
          dígitos para confirmar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <SecretBlock secret={data.secret} otpauthUri={data.otpauthUri} />

        <BackupCodesBlock codes={data.backupCodes} />

        <div className="space-y-2">
          <Label htmlFor="confirm-totp-0">
            Ingresa el primer código de 6 dígitos
          </Label>
          <TotpInput
            id="confirm-totp-0"
            value={token}
            onChange={setToken}
            onComplete={submitVerify}
            disabled={stage === "verifying"}
            invalid={Boolean(error)}
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-between text-sm text-muted-foreground">
        <span>
          {stage === "verifying"
            ? "Verificando…"
            : "El código se valida automáticamente al completar 6 dígitos."}
        </span>
      </CardFooter>
    </Card>
  );
}

// ---- Sub-componentes -------------------------------------------------------

/**
 * Muestra el secret en grupos de 4 y el `otpauth://` URI como texto
 * seleccionable. Cuando se instale `qrcode-svg`, sustituir por SVG inline.
 */
function SecretBlock({
  secret,
  otpauthUri,
}: {
  secret: string;
  otpauthUri: string;
}) {
  // Formatear el secret en grupos de 4 chars para que sea legible al copiarlo
  // a la app autenticadora manualmente.
  const grouped = secret.match(/.{1,4}/g)?.join(" ") ?? secret;

  const copy = (value: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(value);
    }
  };

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium mb-1">
          Opción A — Pega esta URI en tu app
        </p>
        <code className="block break-all rounded bg-background p-2 text-xs">
          {otpauthUri}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => copy(otpauthUri)}
        >
          Copiar URI
        </Button>
      </div>
      <div>
        <p className="text-sm font-medium mb-1">
          Opción B — Agrega manualmente con este secret
        </p>
        <code className="block rounded bg-background p-2 text-sm tracking-wider">
          {grouped}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => copy(secret)}
        >
          Copiar secret
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        TODO Sprint 2: cuando se instale <code>qrcode-svg</code> mostraremos
        un código QR escaneable en lugar de la URI textual.
      </p>
    </div>
  );
}

/**
 * Renderiza los 10 backup codes en grilla con botones para copiar y
 * descargar. Solo se muestran UNA VEZ — el server no los retiene en claro.
 */
function BackupCodesBlock({ codes }: { codes: string[] }) {
  const allText = codes.join("\n");

  const copyAll = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(allText);
    }
  };

  const download = () => {
    if (typeof document === "undefined") return;
    const blob = new Blob(
      [
        "Avante HIS - Códigos de respaldo MFA\n",
        "Guarda este archivo en un lugar seguro.\n",
        "Cada código se puede usar una sola vez.\n\n",
        ...codes.map((c, i) => `${i + 1}. ${c}\n`),
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "avante-mfa-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
      <p className="text-sm font-medium">
        Códigos de respaldo — guárdalos AHORA
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        Los necesitarás si pierdes acceso a tu app autenticadora. No volverán
        a mostrarse.
      </p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="rounded bg-background px-2 py-1">
            {c}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyAll}>
          Copiar todos
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          Descargar .txt
        </Button>
      </div>
    </div>
  );
}
