"use client";

/**
 * Página de configuración de MFA (TOTP) en el Portal del Paciente.
 * Flujo: idle → enrolling (muestra secreto/QR) → done.
 */
import { useState } from "react";
import { api } from "@/lib/trpc/client";

type State = "idle" | "enrolling" | "done";

export default function MfaSettingsPage() {
  const [state, setState] = useState<State>("idle");
  const [secret, setSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const enableMfa = api.portal.account.enableMfa.useMutation({
    onSuccess: (data) => {
      setSecret(data.secret);
      setState("enrolling");
    },
    onError: () => setError("Error al iniciar la configuración. Intente de nuevo."),
  });

  const verifyMfa = api.portal.account.verifyMfa.useMutation({
    onSuccess: (data) => {
      if (!data.success) {
        setError(
          data.reason === "código_inválido"
            ? "Código incorrecto. Intente de nuevo."
            : "Error de configuración.",
        );
        return;
      }
      setState("done");
    },
    onError: () => setError("Error de red. Intente de nuevo."),
  });

  function handleEnable() {
    setError(null);
    enableMfa.mutate();
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    verifyMfa.mutate({ totpCode });
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
          <li>
            O escanee el código QR en:{" "}
            <a
              href={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(otpauthUrl)}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              Ver QR
            </a>
          </li>
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
