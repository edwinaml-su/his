"use client";

/**
 * Página de verificación del magic link.
 * Lee el token de la URL y lo consume vía portal.auth.verifyLogin.
 * Si MFA está habilitado, muestra el campo TOTP antes de crear sesión.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";

function VerifyContent() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [totpCode, setTotpCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verifyLogin = api.portal.auth.verifyLogin.useMutation({
    onSuccess: (data) => {
      if (!data.success) {
        if ("mfaRequired" in data && data.mfaRequired) {
          setMfaRequired(true);
          return;
        }
        setError("El enlace es inválido o ha expirado.");
        return;
      }
      // Almacenar el session token en cookie httpOnly vía server action (US.B20.1.x)
      // Por ahora redirigir al dashboard.
      router.push("/dashboard");
    },
    onError: () => setError("Error de red. Intente de nuevo."),
  });

  useEffect(() => {
    if (token && !mfaRequired) {
      verifyLogin.mutate({ token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    verifyLogin.mutate({ token, totpCode });
  }

  if (verifyLogin.isPending) {
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
            disabled={verifyLogin.isPending}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Verificar
          </button>
        </form>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center space-y-3">
        <p className="text-red-600 font-medium">{error}</p>
        <a href="/login" className="text-blue-600 text-sm hover:underline">
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
