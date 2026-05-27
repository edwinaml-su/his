"use client";

/**
 * Página de alta del Portal del Paciente.
 *
 * Pide DUI + email + identificador del expediente (MRN o ID de paciente).
 * Envía magic-link `REGISTER` al correo si el (DUI, patientId) corresponde a
 * un paciente registrado. Anti-enumeración: la respuesta siempre es la misma
 * — el operador no sabe si el DUI existía o no.
 *
 * Validación client-side de DUI con el mismo algoritmo que el server-side
 * (paridad TS↔SQL en `@his/contracts/validators/index.ts`).
 */
import { useState } from "react";
import { validateDUI } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";

export default function PortalRegisterPage() {
  const [dui, setDui] = useState("");
  const [email, setEmail] = useState("");
  const [patientId, setPatientId] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = trpc.portal.account.register.useMutation({
    onSuccess: () => setSent(true),
    onError: (err) => {
      // K-04 (audit Stream K): el server hace rate-limit por IP + email.
      // Mostramos el mensaje específico cuando es 429; genérico en otros casos.
      setError(
        err.data?.code === "TOO_MANY_REQUESTS"
          ? "Demasiados intentos. Espere unos minutos antes de volver a intentar."
          : "No se pudo procesar el registro. Intente de nuevo.",
      );
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validación client-side de DUI.
    if (!validateDUI(dui)) {
      setError(
        "DUI inválido. Verifique el dígito verificador (formato 00000000-0).",
      );
      return;
    }

    register.mutate({
      dui: dui.trim(),
      email: email.trim().toLowerCase(),
      patientId: patientId.trim(),
    });
  }

  if (sent) {
    return (
      <div
        className="rounded-xl border bg-white p-8 text-center space-y-3"
        role="status"
        aria-live="polite"
      >
        <p className="text-2xl">Solicitud recibida</p>
        <p className="text-slate-600">
          Si el DUI y el expediente coinciden, recibirá un enlace de
          verificación en su correo válido por 15 minutos.
        </p>
        <p className="text-sm text-slate-500">
          ¿No le llega?{" "}
          <a
            href="/portal/login"
            className="text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            Vuelva al inicio
          </a>
          .
        </p>
      </div>
    );
  }

  const duiInvalido = dui.length > 0 && !validateDUI(dui);

  return (
    <div className="rounded-xl border bg-white p-8 space-y-6">
      <h1 className="text-xl font-semibold">Crear cuenta del portal</h1>
      <p className="text-sm text-slate-600">
        Si ya es paciente del hospital, complete sus datos para vincular su
        expediente con el portal. Se le enviará un enlace de verificación.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="dui"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            DUI <span aria-hidden className="text-red-600">*</span>
            <span className="sr-only"> (obligatorio)</span>
          </label>
          <input
            id="dui"
            type="text"
            required
            inputMode="numeric"
            value={dui}
            onChange={(e) => setDui(e.target.value)}
            placeholder="00000000-0"
            autoComplete="off"
            aria-invalid={duiInvalido}
            aria-describedby={duiInvalido ? "dui-error" : "dui-hint"}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {duiInvalido ? (
            <p id="dui-error" role="alert" className="text-xs text-red-600 mt-1">
              DUI inválido. Verifique el dígito verificador.
            </p>
          ) : (
            <p id="dui-hint" className="text-xs text-slate-500 mt-1">
              9 dígitos con o sin guión (formato 00000000-0).
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            Correo electrónico <span aria-hidden className="text-red-600">*</span>
            <span className="sr-only"> (obligatorio)</span>
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com"
            autoComplete="email"
            maxLength={254}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-slate-500 mt-1">
            Aquí recibirá el enlace de verificación y futuras notificaciones.
          </p>
        </div>

        <div>
          <label
            htmlFor="patientId"
            className="block text-sm font-medium text-slate-700 mb-1"
          >
            Número de expediente <span aria-hidden className="text-red-600">*</span>
            <span className="sr-only"> (obligatorio)</span>
          </label>
          <input
            id="patientId"
            type="text"
            required
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            placeholder="Tal como aparece en su carné o admisión"
            autoComplete="off"
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-slate-500 mt-1">
            Si no lo recuerda, solicítelo en admisión o en el carné del
            hospital.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={register.isPending}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {register.isPending ? "Procesando..." : "Crear cuenta"}
        </button>
      </form>

      <p className="text-center text-xs text-slate-500">
        ¿Ya tiene cuenta?{" "}
        <a
          href="/portal/login"
          className="text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        >
          Inicie sesión
        </a>
        .
      </p>
    </div>
  );
}
