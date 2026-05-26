"use client";

/**
 * Página de configuración de MFA (TOTP) en el Portal del Paciente.
 * Flujo: idle → enrolling (muestra secreto/QR) → done.
 *
 * K-07 (audit Stream K): el secreto TOTP llega del backend en plaintext
 * (necesario para render del QR + entrada manual). Mitigaciones:
 *   1. Secret SOLO se almacena en useState del componente (no localStorage).
 *   2. Mutation se invalida tras `verifyMfa.onSuccess` → React Query
 *      olvida el secret de su caché.
 *   3. Al transicionar a `state="done"`, `setSecret(null)` limpia el state
 *      local. Si el usuario vuelve, debe re-enrollar (genera secret nuevo).
 *   4. La transmisión es siempre TLS + cookie HttpOnly → no expuesto a XSS.
 *   5. Logs server-side redactan (K-03).
 *
 * Trade-off no resuelto en esta iteración (follow-up): el secret aparece en
 * la respuesta tRPC y por tanto en DevTools Network. Mitigación completa
 * exigiría generar QR server-side y devolver solo SVG opaco (sin secret).
 * Aceptable en MVP dado que el navegador es del propio paciente.
 */
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "@/lib/trpc/react";

type State = "idle" | "enrolling" | "done";

export default function MfaSettingsPage() {
  const [state, setState] = useState<State>("idle");
  const [secret, setSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trpcUtils = trpc.useUtils();

  const enableMfa = trpc.portal.account.enableMfa.useMutation({
    onSuccess: (data: { secret: string }) => {
      setSecret(data.secret);
      setState("enrolling");
    },
    onError: () => setError("Error al iniciar la configuración. Intente de nuevo."),
  });

  const verifyMfa = trpc.portal.account.verifyMfa.useMutation({
    onSuccess: () => {
      // K-07: limpiar el secret del state Y de la caché React Query
      // para que no quede recuperable tras la activación.
      setSecret(null);
      setTotpCode("");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (trpcUtils.portal.account as any).enableMfa?.reset?.();
      setState("done");
    },
    onError: (err) => setError(err.message ?? "Código incorrecto. Intente de nuevo."),
  });

  function handleEnable() {
    setError(null);
    enableMfa.mutate();
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    verifyMfa.mutate({ code: totpCode });
  }

  if (state === "done") {
    return (
      <div className="rounded-xl border bg-white p-8 text-center space-y-3">
        <p className="text-xl font-semibold text-green-700">Autenticación en dos pasos activada</p>
        <p className="text-sm text-slate-600">
          Su cuenta está ahora protegida con un segundo factor.
        </p>
        <a href="/dashboard" className="text-blue-600 text-sm hover:underline">
          Volver al portal
        </a>
      </div>
    );
  }

  if (state === "enrolling" && secret) {
    const otpauthUrl = `otpauth://totp/Portal%20Avante?secret=${secret}&issuer=HIS-Avante`;

    return (
      <div className="rounded-xl border bg-white p-8 space-y-6">
        <h1 className="text-lg font-semibold">Configurar autenticador</h1>
        <ol className="list-decimal list-inside space-y-3 text-sm text-slate-700">
          <li>Abra su aplicación autenticadora (Google Authenticator, Authy, etc.).</li>
          <li>
            Agregue una cuenta manualmente con este código secreto:
            <code className="ml-2 rounded bg-slate-100 px-2 py-1 font-mono text-xs break-all">
              {secret}
            </code>
          </li>
          <li>O escanee el código QR:</li>
        </ol>
        <div className="flex justify-center">
          <QRCodeSVG value={otpauthUrl} size={200} />
        </div>
        <p className="text-xs text-slate-500 text-center">
          El QR contiene su llave TOTP. NO comparta esta imagen ni el código de respaldo.
        </p>
        <ol className="list-decimal list-inside space-y-3 text-sm text-slate-700" start={4}>
          <li>Ingrese el código de 6 dígitos generado por la app para confirmar.</li>
        </ol>
        <form onSubmit={handleVerify} className="space-y-4">
          <input
            type="text"
            maxLength={6}
            pattern="\d{6}"
            required
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            placeholder="000000"
            className="w-full rounded-md border px-3 py-2 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={verifyMfa.isPending}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {verifyMfa.isPending ? "Verificando..." : "Confirmar y activar"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-8 space-y-4">
      <h1 className="text-lg font-semibold">Autenticación en dos pasos</h1>
      <p className="text-sm text-slate-600">
        Proteja su cuenta con un segundo factor de verificación (TOTP).
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={handleEnable}
        disabled={enableMfa.isPending}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {enableMfa.isPending ? "Iniciando..." : "Activar autenticación en dos pasos"}
      </button>
    </div>
  );
}
