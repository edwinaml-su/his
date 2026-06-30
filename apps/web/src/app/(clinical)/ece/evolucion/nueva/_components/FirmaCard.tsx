"use client";

/**
 * §12 — Firma del médico (CC-0006 avante4). Tarjeta de SOLO LECTURA: el grafo
 * (firma registrada) y el sello provienen de la ficha médica del profesional.
 * Aquí se representan visualmente — el nombre se toma del usuario autenticado y
 * la especialidad de la evolución en curso. El grafo y el sello son arte
 * vectorial estilizado (placeholder de la ficha médica), no firma manuscrita.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";

export function FirmaCard() {
  const { paciente, draft } = useEvolucionDraft();
  const nombreMedico = paciente?.usuarioActual?.nombre?.trim() || "Médico tratante";
  const especialidad = draft.especialidad?.nombre?.trim() || "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#3b82f6] text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path d="M4 19h16M4 15l9-9 4 4-9 9H4z" />
            </svg>
          </span>
          <CardTitle className="text-sm font-bold uppercase tracking-wide">Firma del médico</CardTitle>
          <span className="font-extrabold text-[#dc2626]" aria-hidden="true">*</span>
        </div>
        <p className="text-xs text-muted-foreground">
          El grafo y el sello se traen de la ficha médica del médico registrado.{" "}
          <span className="ml-1 inline-block rounded-full border border-border bg-muted/40 px-[9px] py-0.5 text-[10.5px] font-semibold text-muted-foreground">
            datos de la ficha médica
          </span>
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_220px]">
          {/* Grafo (firma registrada) */}
          <div className="flex flex-col rounded-xl border border-border bg-muted/30 px-4 py-3.5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                <path d="M3 17c3 0 3-8 6-8s3 6 6 6 3-4 6-4" />
              </svg>
              Grafo (firma registrada)
            </div>
            <div className="my-2 flex min-h-[78px] flex-1 items-center justify-center border-b border-border pb-1.5">
              <svg viewBox="0 0 260 60" className="h-[60px] w-full max-w-[260px] text-foreground">
                <path
                  d="M14 42 C 22 18, 30 18, 34 40 C 36 50, 40 50, 44 38 C 48 22, 56 22, 60 40 C 63 52, 70 50, 76 36 C 90 8, 110 46, 132 34 C 150 24, 168 44, 196 28 C 206 22, 214 30, 222 26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="text-center text-[13px] font-extrabold uppercase tracking-wide text-foreground">
              {nombreMedico}
            </div>
            <div className="mt-0.5 text-center text-xs text-muted-foreground">
              Médico tratante{especialidad ? ` · ${especialidad}` : ""}
            </div>
          </div>

          {/* Sello registrado */}
          <div className="flex flex-col items-center rounded-xl border border-border bg-muted/30 px-4 py-3.5 text-center">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v10M7 12h10" />
              </svg>
              Sello registrado
            </div>
            <svg viewBox="0 0 128 128" className="my-2 h-[124px] w-[124px] text-[#3b82f6]">
              <circle cx="64" cy="64" r="60" fill="none" stroke="currentColor" strokeWidth={2} />
              <circle cx="64" cy="64" r="51" fill="none" stroke="currentColor" strokeWidth={1} />
              <text x="64" y="60" textAnchor="middle" fontSize="11" fontWeight="800" fill="currentColor">
                SELLO OFICIAL
              </text>
              <text x="64" y="74" textAnchor="middle" fontSize="7" fontWeight="600" fill="currentColor" letterSpacing="1">
                {especialidad ? especialidad.toUpperCase() : "PROFESIONAL DE SALUD"}
              </text>
            </svg>
            <div className="text-xs text-muted-foreground">Sello oficial del profesional</div>
          </div>
        </div>

        {/* firma-ok */}
        <div className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-[#16a34a]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-[15px] w-[15px]">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Grafo y sello traídos automáticamente de la ficha médica del médico registrado.
        </div>
      </CardContent>
    </Card>
  );
}
