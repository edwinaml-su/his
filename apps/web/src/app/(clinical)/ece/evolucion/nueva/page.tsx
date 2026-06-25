"use client";

/**
 * ECE — Form de nueva evolución médica SOAP (CC-0004 RF-1..5).
 *
 * Layout columna única (top-down):
 *   Encabezado (fecha creación) → ProblemasCard+Modal (S/O/signos) → Análisis → Plan → footer.
 *
 * Patrón: React.useState (D-2 — sin react-hook-form, consistente con el resto del repo).
 * D-3: S/O opcionales en schema; "Guardar borrador" habilitado si hay cualquier contenido;
 *      "Firmar" exige S + O + A + P completos.
 * D-1: si hay signos → eceSignosVitales.create primero → signosVitalesId en data JSONB.
 * R-5: orquestación cliente (signos primero, luego evolución); si signos falla no crea evolución.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";
import {
  ProblemasCard,
} from "./_components/ProblemasCard";
import {
  ProblemasModal,
  PROBLEMAS_INITIAL,
  type ProblemasValue,
} from "./_components/ProblemasModal";

// ─── Estado del formulario ───────────────────────────────────────────────────

interface FormState {
  problemas: ProblemasValue;
  analisis: string;
  plan: string;
}

const FORM_INITIAL: FormState = {
  problemas: PROBLEMAS_INITIAL,
  analisis: "",
  plan: "",
};

// ─── Draft localStorage ──────────────────────────────────────────────────────

const AUTOSAVE_DELAY_MS = 30_000;

function draftKey(episodeId: string | undefined) {
  return `ece-evolucion-draft-${episodeId ?? "sin-episodio"}`;
}

function loadDraft(episodeId: string | undefined): FormState {
  if (typeof window === "undefined") return FORM_INITIAL;
  try {
    const raw = localStorage.getItem(draftKey(episodeId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FormState>;
      return {
        problemas: parsed.problemas ?? PROBLEMAS_INITIAL,
        analisis: parsed.analisis ?? "",
        plan: parsed.plan ?? "",
      };
    }
  } catch {
    // corrupted draft — ignore
  }
  return FORM_INITIAL;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Retorna true si algún signo vital tiene valor ingresado. */
function hasSignosData(signos: ProblemasValue["signos"]): boolean {
  return (
    signos.presionSistolica !== "" ||
    signos.presionDiastolica !== "" ||
    signos.frecuenciaCardiaca !== "" ||
    signos.frecuenciaRespiratoria !== "" ||
    signos.temperatura !== "" ||
    signos.saturacionO2 !== "" ||
    signos.escalaDolor > 0 ||
    signos.pesoKg !== "" ||
    signos.tallaCm !== "" ||
    signos.glucometriaMgdl !== ""
  );
}

function parseOpt(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function NuevaEvolucionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const episodeId = searchParams.get("episodeId") ?? undefined;

  // Fecha de creación = timestamp al montar (RF-1)
  const createdAt = React.useRef(new Date());
  const fechaDisplay = createdAt.current.toLocaleString("es-SV", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const [form, setForm] = React.useState<FormState>(() => loadDraft(episodeId));
  const [modalOpen, setModalOpen] = React.useState(false);
  const [confirmSignOpen, setConfirmSignOpen] = React.useState(false);
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [autosaveMsg, setAutosaveMsg] = React.useState<string | null>(null);

  const createEvolucion = trpc.eceEvolucion.create.useMutation();
  const createSignos = trpc.eceSignosVitales.create.useMutation();
  const sign = trpc.eceEvolucion.firmar.useMutation();
  const utils = trpc.useUtils();

  const isPending = createEvolucion.isPending || createSignos.isPending || sign.isPending;

  const problemasCompleted =
    form.problemas.subjetivo.trim() !== "" || form.problemas.objetivo.trim() !== "";

  // D-3: borrador habilitado con cualquier contenido
  const hasContent =
    problemasCompleted ||
    form.analisis.trim() !== "" ||
    form.plan.trim() !== "" ||
    hasSignosData(form.problemas.signos);

  // D-3: firmar exige SOAP completo (S + O en modal + A + P en página)
  const canSign =
    form.problemas.subjetivo.trim() !== "" &&
    form.problemas.objetivo.trim() !== "" &&
    form.analisis.trim() !== "" &&
    form.plan.trim() !== "";

  // ─── Autosave ─────────────────────────────────────────────────────────────

  const autosaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(episodeId), JSON.stringify(form));
        setAutosaveMsg(
          `Borrador guardado localmente ${new Date().toLocaleTimeString("es-SV")}`,
        );
      } catch {
        // localStorage no disponible — no bloqueante
      }
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [form, episodeId]);

  // ─── Ctrl+S ───────────────────────────────────────────────────────────────

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        try {
          localStorage.setItem(draftKey(episodeId), JSON.stringify(form));
          setAutosaveMsg(
            `Borrador guardado manualmente ${new Date().toLocaleTimeString("es-SV")}`,
          );
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [form, episodeId]);

  // ─── Persistencia ─────────────────────────────────────────────────────────

  function clearDraft() {
    try { localStorage.removeItem(draftKey(episodeId)); } catch { /* ignore */ }
  }

  /** R-5: signos primero (si hay), luego evolución. Ambos en try/catch. */
  async function persistCreate(): Promise<{ id: string } | null> {
    setPageError(null);
    let signosVitalesId: string | undefined;

    // D-1: crear signos si hay algún campo con valor
    if (hasSignosData(form.problemas.signos)) {
      try {
        const sv = form.problemas.signos;
        const { id } = await createSignos.mutateAsync({
          episodioId: episodeId,
          presionSistolica: parseOpt(sv.presionSistolica),
          presionDiastolica: parseOpt(sv.presionDiastolica),
          frecuenciaCardiaca: parseOpt(sv.frecuenciaCardiaca),
          frecuenciaRespiratoria: parseOpt(sv.frecuenciaRespiratoria),
          temperatura: parseOpt(sv.temperatura),
          saturacionO2: parseOpt(sv.saturacionO2),
          escalaDolor: sv.escalaDolor > 0 ? sv.escalaDolor : undefined,
          pesoKg: parseOpt(sv.pesoKg),
          tallaCm: parseOpt(sv.tallaCm),
          glucometriaMgdl: parseOpt(sv.glucometriaMgdl),
        });
        signosVitalesId = id;
      } catch (e) {
        setPageError(
          `Error al guardar signos vitales: ${e instanceof Error ? e.message : "error"}. Verifique que hay un establecimiento activo.`,
        );
        return null;
      }
    }

    try {
      const r = await createEvolucion.mutateAsync({
        episodioId: episodeId ?? "",
        fecha: createdAt.current,
        soapSubjetivo: form.problemas.subjetivo.trim(),
        soapObjetivo: form.problemas.objetivo.trim(),
        soapAnalisis: form.analisis.trim(),
        soapPlan: form.plan.trim(),
        ...(signosVitalesId ? { data: { signosVitalesId } } : {}),
      });
      return r as { id: string };
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Error al guardar.");
      return null;
    }
  }

  async function onSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    const created = await persistCreate();
    if (!created) return;
    clearDraft();
    utils.eceEvolucion.list.invalidate({ episodioId: episodeId });
    router.replace(
      episodeId ? `/ece/evolucion?episodeId=${episodeId}` : "/ece/evolucion",
    );
  }

  async function onSignAndPublish() {
    setConfirmSignOpen(false);
    const created = await persistCreate();
    if (!created) return;
    try {
      await sign.mutateAsync({ id: created.id });
      clearDraft();
      utils.eceEvolucion.list.invalidate({ episodioId: episodeId });
      router.replace(`/ece/evolucion/${created.id}`);
    } catch (e) {
      setPageError(
        `Evolución guardada como borrador, pero falló la firma: ${
          e instanceof Error ? e.message : "error"
        }. Puedes firmar desde el listado.`,
      );
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* RF-1: Encabezado con fecha de creación */}
      <div>
        <h1 className="text-2xl font-bold">Nueva evolución médica</h1>
        <p className="text-sm text-muted-foreground">
          <span>
            Fecha de creación:{" "}
            <time dateTime={createdAt.current.toISOString()} className="font-medium">
              {fechaDisplay}
            </time>
          </span>
          {" · "}
          {episodeId
            ? `Episodio #${episodeId.slice(0, 8)}`
            : "Sin episodio seleccionado"}
          {" · "}Atajo{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-xs">
            Ctrl+S
          </kbd>{" "}
          guarda borrador local.
        </p>
        {autosaveMsg ? (
          <p
            className="mt-1 text-xs text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
            data-testid="autosave-msg"
          >
            {autosaveMsg}
          </p>
        ) : null}
      </div>

      <form onSubmit={onSaveDraft} noValidate>
        {/* RF-2/RF-5: una sola columna, orden top-down */}
        <div className="space-y-4">
          {/* RF-3: Problemas (S+O en modal) */}
          <ProblemasCard
            value={form.problemas}
            isCompleted={problemasCompleted}
            onEdit={() => setModalOpen(true)}
          />

          {/* Análisis (A) */}
          <Card className="border-l-4 border-amber-200 dark:border-amber-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">
                <Label htmlFor="soap-analisis">Evaluación / Análisis (A)</Label>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Diagnóstico o impresión diagnóstica, evolución del cuadro.
              </p>
            </CardHeader>
            <CardContent>
              <textarea
                id="soap-analisis"
                name="analisis"
                value={form.analisis}
                onChange={(e) => setForm((prev) => ({ ...prev, analisis: e.target.value }))}
                rows={8}
                placeholder="Redactar evaluación/análisis…"
                aria-label="Evaluación / Análisis"
                className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </CardContent>
          </Card>

          {/* Plan (P) */}
          <Card className="border-l-4 border-purple-200 dark:border-purple-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">
                <Label htmlFor="soap-plan">Plan (P)</Label>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Conducta terapéutica, indicaciones, seguimiento, interconsultas.
              </p>
            </CardHeader>
            <CardContent>
              <textarea
                id="soap-plan"
                name="plan"
                value={form.plan}
                onChange={(e) => setForm((prev) => ({ ...prev, plan: e.target.value }))}
                rows={8}
                placeholder="Redactar plan…"
                aria-label="Plan"
                className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </CardContent>
          </Card>
        </div>

        {pageError ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {pageError}
          </div>
        ) : null}

        {/* Footer (D-4: botón Firmar conservado) */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={isPending || !hasContent}
            >
              {createEvolucion.isPending ? "Guardando…" : "Guardar borrador"}
            </Button>
            <Button
              type="button"
              onClick={() => setConfirmSignOpen(true)}
              disabled={isPending || !canSign}
              title={!canSign ? "Complete S, O, Análisis y Plan para firmar" : undefined}
            >
              Firmar
            </Button>
          </div>
        </div>
      </form>

      {/* Modal Problemas (RF-3, RF-4) */}
      <ProblemasModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        value={form.problemas}
        onChange={(problemas) => setForm((prev) => ({ ...prev, problemas }))}
      />

      {/* Dialog confirmación firma (D-4: conservado) */}
      <Dialog
        open={confirmSignOpen}
        onOpenChange={(v) => (!v ? setConfirmSignOpen(false) : null)}
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
              disabled={isPending}
            >
              Revisar de nuevo
            </Button>
            <Button
              onClick={() => void onSignAndPublish()}
              disabled={isPending}
            >
              {isPending ? "Procesando…" : "Sí, firmar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
