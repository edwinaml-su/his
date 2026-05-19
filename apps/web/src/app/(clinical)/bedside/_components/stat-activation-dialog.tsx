"use client";

/**
 * StatActivationDialog — Modal de activación del modo STAT (US.F2.6.47).
 *
 * Flujo:
 *   1. Usuario selecciona motivo del catálogo.
 *   2. Si motivo = OTRO_URGENTE, textarea libre obligatorio.
 *   3. GSRN del médico autorizante (scan o input manual).
 *   4. Al confirmar: llama bedside-stat.activate().
 *
 * Una vez activo, el banner StatBanner aparece globalmente.
 * Los hard-stops PACIENTE_NO_COINCIDE, MEDICAMENTO_NO_COINCIDE, FUERA_DE_VENTANA
 * se convierten en warnings (no bloquean) durante la sesión.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/react";
// STAT_MOTIVOS inline porque @his/trpc no exporta el router module directamente
const STAT_MOTIVOS = ["PARO_CARDIORRESPIRATORIO", "HIPOGLUCEMIA_SEVERA", "ANAFILAXIA", "OTRO_URGENTE"] as const;
type StatMotivo = typeof STAT_MOTIVOS[number];

const MOTIVO_LABELS: Record<StatMotivo, string> = {
  PARO_CARDIORRESPIRATORIO: "Paro cardiorrespiratorio",
  HIPOGLUCEMIA_SEVERA:       "Hipoglucemia severa",
  ANAFILAXIA:                "Anafilaxia",
  OTRO_URGENTE:              "Otro urgente (especifique)",
};

interface StatActivationDialogProps {
  indicationId: string;
  patientId: string;
  encounterId?: string;
  onActivated: (statEventId: string) => void;
  onCancel: () => void;
}

export function StatActivationDialog({
  indicationId,
  patientId,
  encounterId,
  onActivated,
  onCancel,
}: StatActivationDialogProps) {
  const [motivo, setMotivo]           = useState<StatMotivo | "">("");
  const [motivoLibre, setMotivoLibre] = useState("");
  const [gsrnMedico, setGsrnMedico]   = useState("");
  const [testigoInput, setTestigoInput] = useState("");
  const [testigos, setTestigos]       = useState<string[]>([]);
  const [error, setError]             = useState<string | null>(null);

  const activate = trpc.bedsideStat.activate.useMutation({
    onSuccess(data) {
      onActivated(data.statEventId);
    },
    onError(err) {
      setError(err.message);
    },
  });

  const addTestigo = () => {
    const trimmed = testigoInput.trim();
    // UUID básico o nombre de usuario — aceptar UUID para el backend
    if (!trimmed || testigos.includes(trimmed)) return;
    if (testigos.length >= 3) {
      setError("Máximo 3 testigos.");
      return;
    }
    setTestigos((t) => [...t, trimmed]);
    setTestigoInput("");
  };

  const removeTestigo = (id: string) => {
    setTestigos((t) => t.filter((x) => x !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!motivo) { setError("Seleccione el motivo STAT."); return; }
    if (motivo === "OTRO_URGENTE" && !motivoLibre.trim()) {
      setError("Describa el motivo urgente.");
      return;
    }
    if (!/^\d{18}$/.test(gsrnMedico)) {
      setError("GSRN médico debe tener 18 dígitos.");
      return;
    }
    if (testigos.length === 0) {
      setError("Registre al menos 1 testigo (UUID del usuario).");
      return;
    }

    activate.mutate({
      indicationId,
      patientId,
      encounterId,
      motivo: motivo as StatMotivo,
      motivoLibre: motivo === "OTRO_URGENTE" ? motivoLibre : undefined,
      gsrnMedico,
      testigos,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stat-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header rojo */}
        <div className="rounded-t-2xl bg-red-600 px-6 py-4 text-white">
          <h2 id="stat-dialog-title" className="text-xl font-extrabold tracking-tight">
            Activar Modo STAT
          </h2>
          <p className="mt-1 text-sm opacity-90">
            Bypass justificado para administración urgente. Quedan en hard-stop:
            medicamento vencido, lote en recall.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {/* Motivo */}
          <div>
            <label htmlFor="stat-motivo" className="block text-sm font-semibold text-gray-700">
              Motivo STAT
            </label>
            <select
              id="stat-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value as StatMotivo | "")}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              required
            >
              <option value="">-- Seleccione --</option>
              {STAT_MOTIVOS.map((m) => (
                <option key={m} value={m}>{MOTIVO_LABELS[m]}</option>
              ))}
            </select>
          </div>

          {/* Motivo libre */}
          {motivo === "OTRO_URGENTE" && (
            <div>
              <label htmlFor="stat-motivo-libre" className="block text-sm font-semibold text-gray-700">
                Descripcion del motivo <span className="text-red-500">*</span>
              </label>
              <textarea
                id="stat-motivo-libre"
                value={motivoLibre}
                onChange={(e) => setMotivoLibre(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Describa la urgencia clínica..."
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                required
              />
            </div>
          )}

          {/* GSRN médico */}
          <div>
            <label htmlFor="stat-gsrn-medico" className="block text-sm font-semibold text-gray-700">
              GSRN médico autorizante (18 dígitos)
            </label>
            <input
              id="stat-gsrn-medico"
              type="text"
              inputMode="numeric"
              maxLength={18}
              value={gsrnMedico}
              onChange={(e) => setGsrnMedico(e.target.value.replace(/\D/g, ""))}
              placeholder="Escanee badge o ingrese GSRN"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              required
            />
          </div>

          {/* Testigos */}
          <div>
            <label className="block text-sm font-semibold text-gray-700">
              Testigos (UUID de usuario, min. 1)
            </label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={testigoInput}
                onChange={(e) => setTestigoInput(e.target.value)}
                placeholder="UUID del testigo"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTestigo(); } }}
              />
              <button
                type="button"
                onClick={addTestigo}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Agregar
              </button>
            </div>
            {testigos.length > 0 && (
              <ul className="mt-2 space-y-1">
                {testigos.map((t) => (
                  <li key={t} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-xs font-mono">
                    <span className="truncate">{t}</span>
                    <button
                      type="button"
                      onClick={() => removeTestigo(t)}
                      className="ml-2 text-red-500 hover:text-red-700"
                      aria-label="Quitar testigo"
                    >
                      x
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Error */}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {/* Botones */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={activate.isPending}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={activate.isPending}
              className="flex-1 rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            >
              {activate.isPending ? "Activando..." : "Activar STAT"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
