"use client";

/**
 * EpicrisisPdfPreview — previsualización imprimible de la epicrisis.
 *
 * Genera un layout MINSAL con:
 *   - Header corporativo Complejo Hospitalario Avante
 *   - Datos del episodio y paciente
 *   - Secciones clínicas (resumen, evolución, diagnósticos, tratamiento, indicaciones)
 *   - Bloque de firmas (MC, ESP, DIR)
 *   - Sello DIR (solo si estado === 'certificado')
 *
 * Para imprimir: window.print() sobre el contenedor `.print-area`.
 * No depende de ninguna librería PDF externa — usa CSS @media print.
 *
 * Accesibilidad: las secciones tienen role="region" con aria-label.
 */

import * as React from "react";
import { CheckCircle2, Lock } from "lucide-react";
import { cn } from "@his/ui/lib/utils";
import { Button } from "@his/ui/components/button";

// ---------------------------------------------------------------------------
// Tipos de datos clínicos
// ---------------------------------------------------------------------------

export interface DiagnosticoItem {
  cie10: string;
  descripcion: string;
  tipo: "principal" | "secundario" | "comorbilidad";
}

export interface EpicrisisPdfData {
  id: string;
  episodioId: string;
  pacienteNombre: string;
  pacienteDui?: string;
  fechaEgreso: Date;
  motivoEgreso: string;
  establecimientoNombre: string;
  servicioNombre?: string;
  diagnosticosEgreso: DiagnosticoItem[];
  resumenIngreso: string;
  evolucionHospitalaria: string;
  tratamientoEgreso: string;
  indicacionesEgreso: string;
  notas?: string | null;
  // Firmantes
  medicoTratanteNombre?: string;
  medicoTratanteNIT?: string;
  especialistaNombre?: string;
  directorNombre?: string;
  directorNIT?: string;
  // Fechas de transición
  firmadoEn?: Date | null;
  validadoEn?: Date | null;
  certificadoEn?: Date | null;
  // Estado
  estado: "borrador" | "firmado" | "validado" | "certificado" | "anulado";
}

interface EpicrisisPdfPreviewProps {
  data: EpicrisisPdfData;
  /** Si true, muestra el botón "Imprimir" sobre el preview. */
  showPrintButton?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat("es-SV", { dateStyle: "long" });
const DATETIME_FMT = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

const MOTIVO_LABEL: Record<string, string> = {
  alta_medica: "Alta médica",
  alta_voluntaria: "Alta voluntaria",
  traslado: "Traslado",
  fallecido: "Fallecido",
  otro: "Otro",
};

function SectionBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      role="region"
      aria-label={title}
      className="border-t pt-3"
    >
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#1a3c6e]">
        {title}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function EpicrisisPdfPreview({
  data,
  showPrintButton = true,
  className,
}: EpicrisisPdfPreviewProps) {
  const principalDx = data.diagnosticosEgreso.filter((d) => d.tipo === "principal");
  const secundarioDx = data.diagnosticosEgreso.filter((d) => d.tipo !== "principal");
  const isCertificado = data.estado === "certificado";

  return (
    <div className={cn("space-y-3", className)}>
      {showPrintButton && (
        <div className="flex justify-end print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            aria-label="Imprimir epicrisis en formato PDF"
          >
            Imprimir / Guardar PDF
          </Button>
        </div>
      )}

      {/* Contenedor imprimible */}
      <div
        className="print-area rounded-lg border bg-white p-8 text-sm text-gray-900 shadow-sm print:border-0 print:shadow-none dark:bg-white dark:text-gray-900"
        aria-label="Vista de impresión de epicrisis"
      >
        {/* Header MINSAL */}
        <header className="mb-6 flex items-start justify-between border-b pb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#1a3c6e]">
              Ministerio de Salud — El Salvador
            </p>
            <h1 className="text-lg font-bold text-[#1a3c6e]">
              EPICRISIS DE EGRESO
            </h1>
            <p className="text-xs text-gray-600">
              {data.establecimientoNombre}
              {data.servicioNombre ? ` — ${data.servicioNombre}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] text-gray-500">
              ID: {data.id.slice(0, 8).toUpperCase()}
            </p>
            <p className="text-xs text-gray-600">
              Episodio: {data.episodioId.slice(0, 8).toUpperCase()}
            </p>
            {isCertificado && (
              <div className="mt-2 flex items-center justify-end gap-1 text-green-700">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                <span className="text-xs font-semibold">CERTIFICADO DIR</span>
              </div>
            )}
            {!isCertificado && (
              <div className="mt-2 flex items-center justify-end gap-1 text-amber-600">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                <span className="text-[10px] font-medium uppercase">
                  {data.estado === "borrador" ? "Borrador" : data.estado}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Datos del paciente */}
        <SectionBlock title="Datos del paciente y episodio">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Paciente</dt>
              <dd className="font-medium">{data.pacienteNombre}</dd>
            </div>
            {data.pacienteDui && (
              <div>
                <dt className="text-xs text-gray-500">DUI</dt>
                <dd className="font-mono">{data.pacienteDui}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-gray-500">Fecha de egreso</dt>
              <dd>{DATE_FMT.format(data.fechaEgreso)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Motivo de egreso</dt>
              <dd>{MOTIVO_LABEL[data.motivoEgreso] ?? data.motivoEgreso}</dd>
            </div>
          </dl>
        </SectionBlock>

        {/* Diagnósticos de egreso */}
        <SectionBlock title="Diagnóstico de egreso (CIE-10)">
          <div className="space-y-1">
            {principalDx.map((dx, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="shrink-0 rounded border border-[#1a3c6e] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#1a3c6e]">
                  {dx.cie10}
                </span>
                <span className="text-sm">
                  {dx.descripcion}
                  <span className="ml-1 text-[10px] text-gray-500">(principal)</span>
                </span>
              </div>
            ))}
            {secundarioDx.map((dx, i) => (
              <div key={i} className="flex items-start gap-2 text-gray-700">
                <span className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]">
                  {dx.cie10}
                </span>
                <span className="text-sm">
                  {dx.descripcion}
                  <span className="ml-1 text-[10px] text-gray-400">({dx.tipo})</span>
                </span>
              </div>
            ))}
          </div>
        </SectionBlock>

        {/* Resumen de ingreso */}
        <SectionBlock title="Resumen de ingreso">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {data.resumenIngreso}
          </p>
        </SectionBlock>

        {/* Evolución hospitalaria */}
        <SectionBlock title="Evolución durante la hospitalización">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {data.evolucionHospitalaria}
          </p>
        </SectionBlock>

        {/* Tratamiento al egreso */}
        <SectionBlock title="Tratamiento al egreso">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {data.tratamientoEgreso}
          </p>
        </SectionBlock>

        {/* Indicaciones al paciente */}
        <SectionBlock title="Indicaciones al paciente / próximos controles">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {data.indicacionesEgreso}
          </p>
        </SectionBlock>

        {/* Notas */}
        {data.notas && (
          <SectionBlock title="Notas adicionales">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
              {data.notas}
            </p>
          </SectionBlock>
        )}

        {/* Bloque de firmas */}
        <section
          role="region"
          aria-label="Firmas y certificación"
          className="mt-6 border-t pt-4"
        >
          <div className="grid grid-cols-3 gap-4">
            {/* MC */}
            <div className="space-y-1 text-center">
              <div className="mx-auto h-12 w-32 border-b border-gray-400" aria-hidden />
              <p className="text-xs font-medium">
                {data.medicoTratanteNombre ?? "Médico Tratante"}
              </p>
              {data.medicoTratanteNIT && (
                <p className="font-mono text-[10px] text-gray-500">
                  NIT: {data.medicoTratanteNIT}
                </p>
              )}
              {data.firmadoEn && (
                <p className="text-[10px] text-gray-400">
                  {DATETIME_FMT.format(data.firmadoEn)}
                </p>
              )}
              <p className="text-[10px] font-semibold uppercase text-[#1a3c6e]">
                Médico MC
              </p>
            </div>

            {/* ESP */}
            <div className="space-y-1 text-center">
              <div className="mx-auto h-12 w-32 border-b border-gray-400" aria-hidden />
              <p className="text-xs font-medium">
                {data.especialistaNombre ?? "Especialista / Jefe de Servicio"}
              </p>
              {data.validadoEn && (
                <p className="text-[10px] text-gray-400">
                  {DATETIME_FMT.format(data.validadoEn)}
                </p>
              )}
              <p className="text-[10px] font-semibold uppercase text-[#1a3c6e]">
                Especialista ESP
              </p>
            </div>

            {/* DIR */}
            <div className="space-y-1 text-center">
              <div
                className={cn(
                  "mx-auto h-12 w-32 border-b",
                  isCertificado
                    ? "border-green-600"
                    : "border-gray-400",
                )}
                aria-hidden
              />
              <p className="text-xs font-medium">
                {data.directorNombre ?? "Director Médico"}
              </p>
              {data.directorNIT && (
                <p className="font-mono text-[10px] text-gray-500">
                  NIT: {data.directorNIT}
                </p>
              )}
              {data.certificadoEn && (
                <p className="text-[10px] text-gray-400">
                  {DATETIME_FMT.format(data.certificadoEn)}
                </p>
              )}
              <p className="text-[10px] font-semibold uppercase text-[#1a3c6e]">
                Director Médico DIR
              </p>
            </div>
          </div>

          {/* Sello DIR — solo si certificado */}
          {isCertificado && (
            <div
              className="mt-4 flex items-center justify-center gap-2 rounded-md border-2 border-green-600 py-3 text-green-700"
              aria-label="Sello de certificación DIR"
            >
              <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
              <div className="text-center">
                <p className="text-xs font-bold uppercase tracking-wide">
                  CERTIFICADO POR DIRECTOR MÉDICO
                </p>
                <p className="text-[10px] text-green-600">
                  Art. 21 NTEC — Acuerdo 1616 MINSAL 2024
                </p>
                {data.certificadoEn && (
                  <p className="text-[10px]">
                    {DATETIME_FMT.format(data.certificadoEn)}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Pie de página */}
        <footer className="mt-6 border-t pt-3 text-center text-[10px] text-gray-400">
          <p>
            Documento generado por HIS Avante — Documento inmutable post-firma (Art. 40 Reglamento ECE)
          </p>
          <p className="mt-0.5 font-mono">
            Hash verificable en {data.id}
          </p>
        </footer>
      </div>
    </div>
  );
}
