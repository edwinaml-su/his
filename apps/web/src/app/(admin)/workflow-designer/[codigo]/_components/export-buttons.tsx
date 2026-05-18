"use client";

/**
 * ExportButtons — Exportación del diagrama como PNG, SVG y PDF (US.F2.2.11).
 *
 * Usa html-to-image para PNG/SVG y jsPDF para PDF (client-side).
 * El elemento a capturar es el contenedor del grafo ReactFlow
 * identificado por data-testid="workflow-graph-container".
 *
 * Decisión: client-side porque el servidor no tiene acceso al DOM renderizado.
 * Trade-off: calidad de fuentes puede diferir vs. Puppeteer server-side (DP-05);
 * aceptable para v1 dada la simplicidad del approach.
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@his/ui/components/dropdown-menu";

interface ExportButtonsProps {
  /** Nombre del workflow (para el nombre del archivo descargado). */
  workflowNombre: string;
  /** Estado del workflow (BORRADOR agrega marca de agua). */
  estadoWorkflow?: "BORRADOR" | "PUBLICADO" | "HISTORICO";
  /** Selector CSS o data-testid del contenedor del grafo. */
  containerSelector?: string;
}

/**
 * Descarga un blob como archivo.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Sanitiza el nombre del workflow para usarlo como nombre de archivo.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_áéíóúñÁÉÍÓÚÑ\s]/g, "").trim().replace(/\s+/g, "-");
}

export function ExportButtons({
  workflowNombre,
  estadoWorkflow = "PUBLICADO",
  containerSelector = '[data-testid="workflow-graph-container"]',
}: ExportButtonsProps) {
  const [exporting, setExporting] = React.useState<"png" | "svg" | "pdf" | null>(null);

  const safeName = sanitizeFilename(workflowNombre);
  const esBorrador = estadoWorkflow === "BORRADOR";

  function getContainer(): HTMLElement | null {
    return document.querySelector<HTMLElement>(containerSelector);
  }

  async function exportPng() {
    const container = getContainer();
    if (!container) return;
    setExporting("png");
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(container, {
        backgroundColor: "#ffffff",
        width: Math.max(container.offsetWidth, 1920),
        height: container.offsetHeight,
      });
      const blob = await fetch(dataUrl).then((r) => r.blob());
      downloadBlob(blob, `${safeName}.png`);
    } finally {
      setExporting(null);
    }
  }

  async function exportSvg() {
    const container = getContainer();
    if (!container) return;
    setExporting("svg");
    try {
      const { toSvg } = await import("html-to-image");
      const dataUrl = await toSvg(container, {
        backgroundColor: "#ffffff",
      });
      const blob = new Blob([
        // dataUrl es "data:image/svg+xml;charset=utf-8,..." — decodificar
        decodeURIComponent(dataUrl.split(",")[1] ?? ""),
      ], { type: "image/svg+xml" });
      downloadBlob(blob, `${safeName}.svg`);
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    const container = getContainer();
    if (!container) return;
    setExporting("pdf");
    try {
      const { toPng } = await import("html-to-image");
      const { jsPDF } = await import("jspdf");

      const dataUrl = await toPng(container, {
        backgroundColor: "#ffffff",
        // Escalar 2x para mejor resolución en PDF
        pixelRatio: 2,
      });

      // A3 landscape (420mm × 297mm)
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      // Reservar 20mm inferiores para pie de página
      const imgH = pageH - 30;
      const imgW = pageW - 20;

      pdf.addImage(dataUrl, "PNG", 10, 10, imgW, imgH);

      // Pie de página
      const pie = [
        workflowNombre,
        esBorrador ? "BORRADOR — No publicado" : "",
        new Date().toLocaleDateString("es-SV"),
      ]
        .filter(Boolean)
        .join("  |  ");

      pdf.setFontSize(9);
      pdf.setTextColor(100);
      pdf.text(pie, 10, pageH - 8);

      if (esBorrador) {
        // Marca de agua diagonal
        pdf.setFontSize(60);
        pdf.setTextColor(220, 220, 220);
        pdf.text("BORRADOR", pageW / 2 - 60, pageH / 2, { angle: 45 });
      }

      pdf.save(`${safeName}.pdf`);
    } finally {
      setExporting(null);
    }
  }

  const isLoading = exporting !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          aria-label="Exportar diagrama"
          data-testid="export-dropdown-trigger"
        >
          {isLoading ? `Exportando ${exporting?.toUpperCase()}...` : "Exportar"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => void exportPng()}
          data-testid="export-png"
          aria-label="Exportar como PNG"
        >
          Exportar PNG
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void exportSvg()}
          data-testid="export-svg"
          aria-label="Exportar como SVG"
        >
          Exportar SVG
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void exportPdf()}
          data-testid="export-pdf"
          aria-label="Exportar como PDF (A3)"
        >
          Exportar PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
