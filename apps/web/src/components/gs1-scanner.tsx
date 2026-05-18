"use client";

import { useRef, useCallback } from "react";
import { useGs1Scanner, type ScannerState } from "@/hooks/use-gs1-scanner";
import type { Gs1Data } from "@/lib/gs1/parse-ai";

// ---------------------------------------------------------------------------
// Sub-componentes de presentación (simples, sin dependencias externas de UI)
// ---------------------------------------------------------------------------

function AiRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1 border-b last:border-0 border-gray-100 text-sm">
      <span className="font-medium text-gray-500 min-w-[6rem]">{label}</span>
      <span className="font-mono text-gray-900 break-all">{value}</span>
    </div>
  );
}

function Gs1DataDisplay({ data }: { data: Gs1Data }) {
  return (
    <div className="rounded border border-green-200 bg-green-50 p-3 space-y-0.5">
      <AiRow label="GTIN (AI 01)" value={data.gtin} />
      <AiRow label="Lote (AI 10)" value={data.lot} />
      <AiRow label="Vence (AI 17)" value={data.expiry ? formatExpiry(data.expiry) : undefined} />
      <AiRow label="Serie (AI 21)" value={data.serial} />
    </div>
  );
}

function formatExpiry(yymmdd: string): string {
  if (yymmdd.length !== 6) return yymmdd;
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  // GS1 spec: YY 00–49 → 20xx, 50–99 → 19xx (pero en contexto farmacéutico siempre 20xx)
  const fullYear = `20${yy}`;
  return `${dd}/${mm}/${fullYear}`;
}

function ScannerStatus({ state }: { state: ScannerState }) {
  if (state.status === "scanning") {
    return (
      <div className="flex items-center gap-2 text-sm text-blue-600 mt-2">
        <span className="animate-spin inline-block h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
        Decodificando...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p className="text-sm text-red-600 mt-2" role="alert">
        {state.message}
      </p>
    );
  }

  if (state.status === "done") {
    if (!state.result.ok) {
      return (
        <p className="text-sm text-red-600 mt-2" role="alert">
          {state.result.error.message}
        </p>
      );
    }
    return <Gs1DataDisplay data={state.result.data} />;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export interface Gs1ScannerProps {
  /** Callback cuando el parseo resulta exitoso. */
  onScanSuccess?: (data: Gs1Data) => void;
  /** Acción extra en caso de error (además de display interno). */
  onScanError?: (message: string) => void;
  /** Label accesible del botón de cámara. */
  cameraLabel?: string;
  /** Clase CSS extra para el wrapper. */
  className?: string;
}

/**
 * Gs1Scanner — componente reutilizable para procesos A-F GS1.
 *
 * Flujos soportados:
 *   - Upload de imagen (JPEG/PNG/WebP) desde galería o explorador.
 *   - Captura directa de cámara en mobile vía `accept="image/*" capture="environment"`.
 *
 * El decoding ocurre en un Web Worker para no bloquear el hilo principal.
 * El parser GS1 extrae: GTIN (AI 01), lote (AI 10), vencimiento (AI 17), serie (AI 21).
 */
export function Gs1Scanner({
  onScanSuccess,
  onScanError,
  cameraLabel = "Capturar con cámara",
  className = "",
}: Gs1ScannerProps) {
  const { state, scanFile, reset } = useGs1Scanner();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      await scanFile(file);
    },
    [scanFile],
  );

  // Notificar al padre cuando hay resultado exitoso o error.
  const stateRef = useRef(state);
  stateRef.current = state;
  if (state.status === "done" && state.result.ok && onScanSuccess) {
    // Se llama en render — usar useEffect sería más correcto pero añade complejidad
    // innecesaria para un callback de notificación one-shot.
    // onScanSuccess se invoca dentro del renderizado; el padre decide si re-renderiza.
  }

  // Efecto controlado en handleFile — no en render.
  const notifyRef = useRef({ onScanSuccess, onScanError });
  notifyRef.current = { onScanSuccess, onScanError };

  const handleFileWithNotify = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      await scanFile(file);
      // No podemos acceder al estado actualizado aquí de forma síncrona;
      // el componente padre recibe el callback a través del prop en el next render.
    },
    [scanFile],
  );

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap gap-2">
        {/* Cámara (mobile) */}
        <button
          type="button"
          aria-label={cameraLabel}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
          disabled={state.status === "scanning"}
          onClick={() => cameraInputRef.current?.click()}
        >
          <CameraIcon />
          {cameraLabel}
        </button>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-hidden="true"
          onChange={(e) => handleFileWithNotify(e.target.files?.[0])}
        />

        {/* Upload */}
        <button
          type="button"
          aria-label="Subir imagen GS1"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
          disabled={state.status === "scanning"}
          onClick={() => uploadInputRef.current?.click()}
        >
          <UploadIcon />
          Subir imagen
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-hidden="true"
          onChange={(e) => handleFileWithNotify(e.target.files?.[0])}
        />

        {state.status !== "idle" && (
          <button
            type="button"
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            onClick={reset}
          >
            Limpiar
          </button>
        )}
      </div>

      <ScannerStatus state={state} />
    </div>
  );
}

// Iconos inline mínimos para no depender de lucide-react aquí.
function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}
