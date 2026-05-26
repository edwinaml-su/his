"use client";

/**
 * Página de verificación del magic link.
 *
 * El token de URL se envía a la server action `verifyMagicLink` que:
 *   1. Llama internamente al procedure `portal.auth.verifyLogin` (server-side).
 *   2. Si éxito, mueve el session token a una cookie HttpOnly y devuelve
 *      `{ status: "OK", redirectTo }`. El cliente NUNCA ve el token raw.
 *   3. Si requiere MFA, devuelve `{ status: "MFA_REQUIRED" }` y mostramos
 *      el campo TOTP.
 *
 * Cierra K-02 del audit Stream K (session token nunca persistido como cookie).
 * Cierra K-08 del audit Stream K (token removido de URL antes de MFA wait).
 */
import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { verifyMagicLink, type VerifyResult } from "./actions";

function VerifyContent() {
  const params = useSearchParams();
  const router = useRouter();
  // K-08: capturar el token en ref/state inmediatamente; se limpiará de la URL
  // antes de entrar al estado MFA_REQUIRED para evitar exposición en history.
  const tokenFromUrl = params.get("token") ?? "";
  const [tokenInState, setTokenInState] = useState(tokenFromUrl);
  const [totpCode, setTotpCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Evita que el effect se dispare de nuevo cuando limpiamos el token de la URL
  const tokenConsumed = useRef(false);

  function handleResult(result: VerifyResult) {
    if (result.status === "OK") {
      // K-29: redirigir al dashboard del portal, no al admin.
      router.replace(result.redirectTo ?? "/portal/dashboard");
      return;
    }
    if (result.status === "MFA_REQUIRED") {
      // K-08: limpiar URL antes de mostrar pantalla MFA; el token ya está en
      // tokenInState para el segundo call con TOTP.
      router.replace("/portal/verify");
      setMfaRequired(true);
      return;
    }
    setError(result.message ?? "Error de red. Intente de nuevo.");
  }

  function dispatchVerify(payload: { token: string; totpCode?: string }) {
    setError(null);
    startTransition(async () => {
      const result = await verifyMagicLink(payload);
      handleResult(result);
    });
  }

  useEffect(() => {
    // K-08: tokenConsumed evita reintento cuando tokenFromUrl queda vacío tras
    // limpiar la URL con router.replace("/portal/verify").
    if (tokenFromUrl && !tokenConsumed.current) {
      tokenConsumed.current = true;
      setTokenInState(tokenFromUrl);
      dispatchVerify({ token: tokenFromUrl });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenFromUrl]);

  function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    dispatchVerify({ token: tokenInState, totpCode });
  }

  if (pending && !mfaRequired) {
    return <p className="text-center text-slate-600">Verificando enlace...</p>;
  }

  if (mfaRequired) {
    return (
      <div className="rounded-xl border bg-white p-8 space-y-4">
        <h1 className="text-lg font-semibold">Verificación en dos pasos</h1>
        <p className="text-sm text-slate-600">
          Ingrese el código de 6 dígitos de su aplicación autenticadora.
        </p>
        <form onSubmit={handleMfaSubmit} className="space-y-4">
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
            disabled={pending}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "Verificando..." : "Verificar"}
          </button>
        </form>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center space-y-3">
        <p className="text-red-600 font-medium">{error}</p>
        <a href="/portal/login" className="text-blue-600 text-sm hover:underline">
          Solicitar nuevo enlace
        </a>
      </div>
    );
  }

  return null;
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="text-center text-slate-600">Cargando...</p>}>
      <VerifyContent />
    </Suspense>
  );
}
