"use client";

/**
 * Página: Historial de pulseras GSRN del paciente.
 * US.F2.6.37-40 — Ruta: /patients/[id]/gsrn-history
 *
 * Acceso: ADMIN / ADMISION (verificado a nivel router; RBAC app-layer).
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

function StatusBadge({ status }: { status: "ACTIVE" | "REVOKED" }) {
  return status === "ACTIVE" ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-800">
      Activa
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600">
      Revocada
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal emisión de nueva pulsera
// ---------------------------------------------------------------------------

function RefreshModal({
  patientId,
  onClose,
  onSuccess,
}: {
  patientId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [newGsrn, setNewGsrn] = useState("");
  const [motivo, setMotivo] = useState("DETERIORO_PULSERA");
  const [gsrnError, setGsrnError] = useState<string | null>(null);

  const refresh = trpc.patientIdentification.refreshGsrn.useMutation({
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  function gs1CheckDigitValid(code: string): boolean {
    if (!/^\d{18}$/.test(code)) return false;
    const len = code.length;
    let sum = 0;
    for (let i = 0; i < len - 1; i++) {
      const fromRight = len - 1 - i;
      const weight = fromRight % 2 === 1 ? 3 : 1;
      sum += parseInt(code[i]!, 10) * weight;
    }
    const expected = (10 - (sum % 10)) % 10;
    return expected === parseInt(code[len - 1]!, 10);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGsrnError(null);
    const trimmed = newGsrn.trim();
    if (!gs1CheckDigitValid(trimmed)) {
      setGsrnError("GSRN inválido. Verifique que sean 18 dígitos con dígito verificador GS1.");
      return;
    }
    refresh.mutate({ patientId, newGsrn: trimmed, motivoRevocacion: motivo });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="refresh-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 id="refresh-modal-title" className="text-lg font-semibold text-gray-900">
          Emitir nueva pulsera GSRN
        </h2>
        <p className="text-sm text-gray-600">
          La pulsera activa actual será revocada. Escanee o ingrese el GSRN de la nueva
          pulsera impresa.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-gsrn" className="block text-sm font-medium text-gray-700 mb-1">
              Nuevo GSRN (18 dígitos)
            </label>
            <input
              id="new-gsrn"
              type="text"
              inputMode="numeric"
              pattern="\d{18}"
              maxLength={18}
              value={newGsrn}
              onChange={(e) => { setNewGsrn(e.target.value); setGsrnError(null); }}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              autoFocus
            />
            {gsrnError && (
              <p className="mt-1 text-sm text-red-600" role="alert">{gsrnError}</p>
            )}
          </div>

          <div>
            <label htmlFor="motivo" className="block text-sm font-medium text-gray-700 mb-1">
              Motivo de revocación
            </label>
            <select
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="DETERIORO_PULSERA">Deterioro / pulsera ilegible</option>
              <option value="ALTA_HOSPITALARIA">Alta hospitalaria (reasignación)</option>
              <option value="CORRECCION_ERROR">Corrección de error</option>
              <option value="SOLICITUD_PACIENTE">Solicitud del paciente</option>
              <option value="OTRO">Otro</option>
            </select>
          </div>

          {refresh.error && (
            <p className="text-sm text-red-600" role="alert">
              {refresh.error.message === "GSRN_DUPLICADO"
                ? "Este GSRN ya está asignado a otro paciente."
                : refresh.error.message}
            </p>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={refresh.isPending}
              className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {refresh.isPending ? "Emitiendo..." : "Emitir nueva pulsera"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function GsrnHistoryPage() {
  const params = useParams<{ id: string }>();
  const [showModal, setShowModal] = useState(false);

  const history = trpc.patientIdentification.getHistory.useQuery(
    { patientId: params.id },
    { refetchOnWindowFocus: false },
  );

  const patientQuery = trpc.patient.get.useQuery({ id: params.id });

  if (history.isLoading || patientQuery.isLoading) {
    return <p className="text-sm text-gray-500 p-4">Cargando historial...</p>;
  }

  if (history.error) {
    return (
      <p className="text-sm text-red-600 p-4" role="alert">
        {history.error.message}
      </p>
    );
  }

  const patient = patientQuery.data;
  const entries = history.data ?? [];
  const activeEntry = entries.find((e) => e.status === "ACTIVE");

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Historial de Pulseras GSRN</h1>
          {patient && (
            <p className="text-sm text-gray-500">
              {patient.lastName}, {patient.firstName} · MRN {patient.mrn}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="shrink-0 px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          Emitir nueva pulsera
        </button>
      </div>

      {/* Pulsera activa */}
      {activeEntry && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-800">
            Pulsera activa
          </p>
          <p className="font-mono text-lg font-bold text-gray-900">{activeEntry.gsrn}</p>
          <p className="text-sm text-gray-600">
            Asignada: {formatDate(activeEntry.assignedAt)}
          </p>
          <button
            type="button"
            onClick={() => window.print()}
            className="mt-2 text-sm text-blue-600 hover:underline"
          >
            Imprimir pulsera actual
          </button>
        </div>
      )}

      {!activeEntry && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            Este paciente no tiene pulsera activa. Use el botón &quot;Emitir nueva pulsera&quot;.
          </p>
        </div>
      )}

      {/* Historial tabla */}
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-700">GSRN</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Asignada</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Revocada</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Sin historial de pulseras.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{e.gsrn}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={e.status} />
                </td>
                <td className="px-4 py-3 text-gray-600">{formatDate(e.assignedAt)}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(e.revokedAt)}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{e.motivoRevocacion ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <RefreshModal
          patientId={params.id}
          onClose={() => setShowModal(false)}
          onSuccess={() => void history.refetch()}
        />
      )}
    </div>
  );
}
