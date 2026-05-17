"use client";

/**
 * Página de login del Portal del Paciente.
 * Solicita un magic link passwordless al correo registrado.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc/react";

export default function PortalLoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestLogin = trpc.portal.auth.requestLogin.useMutation({
    onSuccess: () => setSent(true),
    onError: () => setError("Error al enviar el enlace. Intente de nuevo."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    requestLogin.mutate({ email });
  }

  if (sent) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center space-y-3">
        <p className="text-2xl">Revise su correo</p>
        <p className="text-slate-600">
          Si el correo está registrado, recibirá un enlace de acceso válido por 15 minutos.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-8 space-y-6">
      <h1 className="text-xl font-semibold">Acceder al portal</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
            Correo electrónico
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com"
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={requestLogin.isPending}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {requestLogin.isPending ? "Enviando..." : "Enviar enlace de acceso"}
        </button>
      </form>
      <p className="text-center text-xs text-slate-500">
        ¿Aún no tiene cuenta?{" "}
        <a href="/register" className="text-blue-600 hover:underline">
          Regístrese aquí
        </a>
      </p>
    </div>
  );
}
