"use client";

/**
 * Toolbar del dashboard — rango fechas + acciones de export.
 *
 * Acciones:
 *   - Imprimir: usa window.print() (CSS @media print en globals.css).
 *   - Descargar CSV: serializa los KPIs del estado actual al portapapeles
 *     descargable.
 *   - Exportar PDF: usa jspdf cliente (mismo contenido que print).
 *   - Enviar por correo: server action mock (registra en bitácora; integración
 *     real con SMTP/Resend pendiente).
 */
import * as React from "react";
import {
  Printer,
  Download,
  FileDown,
  Mail,
  Loader2,
} from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import type { KpiDefinition } from "../_lib/kpi-catalog";
import type { KpiValue } from "./kpi-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@his/ui/components/dialog";
import { sendKpiReportByEmail } from "../_actions/send-report";

export interface ToolbarProps {
  fechaDesde: string;
  fechaHasta: string;
  onFechasChange: (desde: string, hasta: string) => void;
  /** Snapshot actual de KPIs (definición + valor) para exportes. */
  snapshot: Array<{ kpi: KpiDefinition; value: KpiValue | null }>;
}

export function Toolbar({ fechaDesde, fechaHasta, onFechasChange, snapshot }: ToolbarProps) {
  const [pending, startTransition] = React.useTransition();

  function handlePrint() {
    window.print();
  }

  function handleExportCsv() {
    const headers = ["categoria", "id", "titulo", "valor", "unidad", "meta", "semaforo", "dataSource"];
    const rows = snapshot.map(({ kpi, value }) => [
      kpi.categoria,
      kpi.id,
      `"${kpi.titulo.replace(/"/g, '""')}"`,
      value?.display ?? "",
      kpi.unidad,
      `"${kpi.meta.replace(/"/g, '""')}"`,
      value?.semaforo ?? "neutro",
      kpi.dataSource,
    ].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kpi-ejecutivo-${fechaDesde}_${fechaHasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportPdf() {
    // Lazy import para no inflar el bundle inicial.
    const jsPDF = (await import("jspdf")).default;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    const margin = 14;
    let y = margin;
    doc.setFontSize(14);
    doc.text("Dashboard Ejecutivo HIS — KPIs", margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.text(`Periodo: ${fechaDesde} → ${fechaHasta}`, margin, y);
    y += 4;
    doc.text(`Generado: ${new Date().toLocaleString("es-SV")}`, margin, y);
    y += 8;

    for (const { kpi, value } of snapshot) {
      if (y > 280) { doc.addPage(); y = margin; }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(`[${kpi.categoria.toUpperCase()}] ${kpi.titulo}`, margin, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Valor: ${value?.display ?? "—"} · Meta: ${kpi.meta}`, margin, y);
      y += 4;
      const desc = doc.splitTextToSize(kpi.descripcion, 180);
      doc.text(desc, margin, y);
      y += desc.length * 4 + 2;
    }
    doc.save(`kpi-ejecutivo-${fechaDesde}_${fechaHasta}.pdf`);
  }

  // Email dialog state
  const [emailOpen, setEmailOpen] = React.useState(false);
  const [recipient, setRecipient] = React.useState("");
  const [emailMsg, setEmailMsg] = React.useState<string | null>(null);

  async function handleSendEmail() {
    if (!recipient.includes("@")) {
      setEmailMsg("Correo inválido");
      return;
    }
    setEmailMsg(null);
    startTransition(async () => {
      const result = await sendKpiReportByEmail({
        recipient,
        fechaDesde,
        fechaHasta,
        kpis: snapshot.map(({ kpi, value }) => ({
          categoria: kpi.categoria,
          titulo: kpi.titulo,
          valor: value?.display ?? "—",
          meta: kpi.meta,
        })),
      });
      if (result.ok) {
        setEmailMsg(`✓ ${result.message ?? "Enviado"}`);
        setTimeout(() => { setEmailOpen(false); setEmailMsg(null); setRecipient(""); }, 1500);
      } else {
        setEmailMsg(`✗ ${result.error ?? "Error al enviar"}`);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-3 print:hidden sm:flex-row sm:items-end sm:justify-between">
      {/* Rango de fechas */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="fecha-desde" className="text-xs">Desde</Label>
          <Input
            id="fecha-desde"
            type="date"
            value={fechaDesde}
            onChange={(e) => onFechasChange(e.target.value, fechaHasta)}
            className="h-9 w-[140px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fecha-hasta" className="text-xs">Hasta</Label>
          <Input
            id="fecha-hasta"
            type="date"
            value={fechaHasta}
            onChange={(e) => onFechasChange(fechaDesde, e.target.value)}
            className="h-9 w-[140px]"
          />
        </div>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
          <Printer className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Imprimir</span>
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
          <Download className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">CSV</span>
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPdf} className="gap-1.5">
          <FileDown className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">PDF</span>
        </Button>
        <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Mail className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Correo</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Enviar reporte por correo</DialogTitle>
              <DialogDescription>
                Envía el snapshot actual de KPIs como resumen ejecutivo al
                destinatario indicado. Periodo: {fechaDesde} → {fechaHasta}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="email-recipient">Destinatario</Label>
              <Input
                id="email-recipient"
                type="email"
                placeholder="director@hospital.com"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
              {emailMsg && (
                <p
                  role="status"
                  className={emailMsg.startsWith("✓") ? "text-sm text-emerald-600" : "text-sm text-destructive"}
                >
                  {emailMsg}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEmailOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={handleSendEmail} disabled={pending || !recipient}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
