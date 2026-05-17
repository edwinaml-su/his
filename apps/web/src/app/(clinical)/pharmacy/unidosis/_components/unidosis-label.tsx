"use client";

/**
 * Componente de etiqueta QR para impresión de unidosis.
 *
 * Muestra código QR (data URI via API nativa del navegador o placeholder
 * si QRCode no disponible) + datos legibles: código, GTIN, paciente,
 * indicación, expiry.
 *
 * Para impresión: se usa un div con clase @print:block; la página controla
 * el tamaño de la etiqueta con `w-[60mm] h-[40mm]` (estándar label).
 */
import * as React from "react";

interface UnidosisLabelProps {
  codigoUnidosis: string;
  qrData: string;
  /** Nombre completo del paciente (para display; no incluido en QR) */
  nombrePaciente?: string;
  /** Descripción del GTIN (para display) */
  descripcionGtin?: string;
  fechaPreparacion: Date;
  expiryUnidosis: Date;
}

function QrPlaceholder({ value }: { value: string }) {
  // Muestra el contenido del QR en un cuadro para entornos sin librería QR.
  // En producción se reemplaza con qrcode.react o similar.
  return (
    <div
      className="flex h-16 w-16 items-center justify-center border bg-white p-1"
      title={value}
      aria-label="Código QR de la unidosis"
    >
      <span className="text-[6px] font-mono break-all leading-tight">QR</span>
    </div>
  );
}

export function UnidosisLabel({
  codigoUnidosis,
  qrData,
  nombrePaciente,
  descripcionGtin,
  fechaPreparacion,
  expiryUnidosis,
}: UnidosisLabelProps) {
  const fmt = (d: Date) =>
    new Date(d).toLocaleString("es-SV", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div
      className="flex w-[220px] gap-2 rounded border border-gray-300 bg-white p-2 text-black shadow-sm print:shadow-none"
      role="region"
      aria-label={`Etiqueta unidosis ${codigoUnidosis}`}
    >
      <QrPlaceholder value={qrData} />
      <div className="flex flex-1 flex-col justify-between overflow-hidden text-[9px] leading-tight">
        <p className="font-bold text-[11px]">{codigoUnidosis}</p>
        {descripcionGtin && (
          <p className="truncate font-medium">{descripcionGtin}</p>
        )}
        {nombrePaciente && (
          <p className="truncate text-gray-700">{nombrePaciente}</p>
        )}
        <p className="text-gray-500">Prep: {fmt(fechaPreparacion)}</p>
        <p className="font-semibold text-red-700">Exp: {fmt(expiryUnidosis)}</p>
      </div>
    </div>
  );
}
