"use client";

/**
 * ECE — Nueva Evolución Médica SOAP (CC-0006 PASO 2).
 *
 * Orquestador: Provider + secciones-resumen + host de modales + footer + dialog firma.
 * Todo ingreso de texto va en modal; las secciones muestran resumen.
 *
 * Autosave: lazy-create en Supabase al primer cambio con contenido (sin localStorage).
 * Firmar: inmutable tras firma (trigger DB). Gating Avante: todos los campos
 * obligatorios (problemas, S, signos núcleo, O, análisis, plan) — ver camposFaltantes.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";

import { EvolucionDraftProvider, useEvolucionDraft } from "./_hooks/useEvolucionDraft";
import { useModalController } from "./_hooks/useModalController";

import { PacienteContextoBar } from "./_components/PacienteContextoBar";
import { EspecialidadCard } from "./_components/EspecialidadCard";
import { ProblemasSection } from "./_components/ProblemasSection";
import { SubjetivoCard } from "./_components/SubjetivoCard";
import { ObjetivoCard } from "./_components/ObjetivoCard";
import { AnalisisCard } from "./_components/AnalisisCard";
import { PlanSection } from "./_components/PlanSection";
import { FirmaCard } from "./_components/FirmaCard";
import { EvolucionFooter } from "./_components/EvolucionFooter";

import { ProblemaModal } from "./_components/modals/ProblemaModal";
import { AgruparModal } from "./_components/modals/AgruparModal";
import { SubjetivoModal } from "./_components/modals/SubjetivoModal";
import { VitalesModal } from "./_components/modals/VitalesModal";
import { ObjetivoModal } from "./_components/modals/ObjetivoModal";
import { AnalisisModal } from "./_components/modals/AnalisisModal";
import { PlanItemModal } from "./_components/modals/PlanItemModal";

// ─── Cuerpo interno (requiere el Provider en el árbol) ───────────────────────

function NuevaEvolucionBody() {
  const router = useRouter();
  const { sign, fecha } = useEvolucionDraft();

  const mc = useModalController();
  const [confirmSignOpen, setConfirmSignOpen] = React.useState(false);
  const [isSigning, setIsSigning] = React.useState(false);

  // Estado para los IDs temporales que necesitan los modales con id
  const [problemaEditId, setProblemaEditId] = React.useState<string | undefined>();
  const [gruparIds, setGruparIds] = React.useState<string[]>([]);
  const [planEditId, setPlanEditId] = React.useState<string | undefined>();

  const fechaDisplay = fecha.toLocaleString("es-SV", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // ── Manejadores de apertura de modales ────────────────────────────────────

  function abrirProblema(id?: string) {
    setProblemaEditId(id);
    mc.abrir({ tipo: "problema", problemaId: id });
  }

  function abrirAgrupar(ids: string[]) {
    setGruparIds(ids);
    mc.abrir({ tipo: "agrupar" });
  }

  function abrirPlan(id?: string) {
    setPlanEditId(id);
    mc.abrir({ tipo: "plan", indicacionId: id });
  }

  // ── Firma ─────────────────────────────────────────────────────────────────

  async function handleConfirmarFirma() {
    setConfirmSignOpen(false);
    setIsSigning(true);
    try {
      await sign();
    } finally {
      setIsSigning(false);
    }
  }

  // ── Ctrl+S ────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        // El autosave se dispara solo al cambiar el estado; Ctrl+S es solo feedback visual
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pb-24">
      {/* Encabezado */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Nueva evolución médica</h1>
        <p className="text-sm text-muted-foreground">
          Fecha:{" "}
          <time dateTime={fecha.toISOString()} className="font-medium">
            {fechaDisplay}
          </time>
          {" · "}Atajo{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-xs">
            Ctrl+S
          </kbd>{" "}
          guarda borrador.
        </p>
      </div>

      {/* Contexto del paciente (R3) */}
      <div className="mb-4">
        <PacienteContextoBar />
      </div>

      {/* Secciones */}
      <div className="space-y-4">
        <EspecialidadCard />

        <ProblemasSection
          onAgregarProblema={() => abrirProblema()}
          onEditarProblema={(id) => abrirProblema(id)}
          onAgrupar={abrirAgrupar}
        />

        <SubjetivoCard onAbrir={() => mc.abrir({ tipo: "subjetivo" })} />

        <ObjetivoCard
          onAbrirVitales={() => mc.abrir({ tipo: "vitales" })}
          onAbrirObjetivo={() => mc.abrir({ tipo: "objetivo" })}
        />

        <AnalisisCard onAbrir={() => mc.abrir({ tipo: "analisis" })} />

        <PlanSection
          onAgregar={() => abrirPlan()}
          onEditar={(id) => abrirPlan(id)}
        />

        <FirmaCard />
      </div>

      {/* Footer */}
      <EvolucionFooter
        onCancelar={() => router.back()}
        onFirmar={() => setConfirmSignOpen(true)}
        isSigning={isSigning}
      />

      {/* ── Modales ─────────────────────────────────────────────────────── */}

      <ProblemaModal
        open={mc.modal.tipo === "problema"}
        onClose={mc.cerrar}
        problemaId={problemaEditId}
      />

      <AgruparModal
        open={mc.modal.tipo === "agrupar"}
        onClose={mc.cerrar}
        selectedIds={gruparIds}
        onDone={mc.cerrar}
      />

      <SubjetivoModal
        open={mc.modal.tipo === "subjetivo"}
        onClose={mc.cerrar}
      />

      <VitalesModal
        open={mc.modal.tipo === "vitales"}
        onClose={mc.cerrar}
      />

      <ObjetivoModal
        open={mc.modal.tipo === "objetivo"}
        onClose={mc.cerrar}
      />

      <AnalisisModal
        open={mc.modal.tipo === "analisis"}
        onClose={mc.cerrar}
      />

      <PlanItemModal
        open={mc.modal.tipo === "plan"}
        onClose={mc.cerrar}
        indicacionId={planEditId}
      />

      {/* ── Dialog confirmación firma ────────────────────────────────────── */}
      <Dialog
        open={confirmSignOpen}
        onOpenChange={(v) => { if (!v) setConfirmSignOpen(false); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Firmar y publicar evolución</DialogTitle>
            <DialogDescription>
              Una vez firmada, la evolución{" "}
              <strong>no podrá editarse</strong>. Esta acción queda registrada
              en el log de auditoría con tu identidad.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmSignOpen(false)}
              disabled={isSigning}
            >
              Revisar de nuevo
            </Button>
            <Button
              onClick={() => void handleConfirmarFirma()}
              disabled={isSigning}
            >
              {isSigning ? "Procesando…" : "Sí, firmar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Exportación con Provider ────────────────────────────────────────────────

export default function NuevaEvolucionPage() {
  const searchParams = useSearchParams();
  const episodeId = searchParams.get("episodeId") ?? undefined;

  return (
    <EvolucionDraftProvider episodeId={episodeId}>
      <NuevaEvolucionBody />
    </EvolucionDraftProvider>
  );
}
