"use client";

/**
 * ECE — Form de nueva evolución médica SOAP.
 *
 * UX:
 *   - 4 textareas grandes (rows=8), una por sección SOAP, en grid 2x2 desktop.
 *   - Autosave a localStorage cada 30 s (debounced, efecto React).
 *   - Atajo Ctrl+S guarda borrador local inmediatamente.
 *   - "Guardar borrador" → persiste sin firma, redirige al listado.
 *   - "Firmar" → dialog de confirmación → persiste + firma → redirige al detalle.
 *
 * Patrón: React.useState (sin react-hook-form, consistente con el resto del repo).
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

type SoapKey = "subjective" | "objective" | "assessment" | "plan";

interface SoapState {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

const SOAP_FIELDS: {
  key: SoapKey;
  label: string;
  hint: string;
  color: string;
}[] = [
  {
    key: "subjective",
    label: "Subjetivo (S)",
    hint: "Relato del paciente: motivo de consulta, síntomas, evolución.",
    color: "border-blue-200 dark:border-blue-800",
  },
  {
    key: "objective",
    label: "Objetivo (O)",
    hint: "Hallazgos al examen físico, signos vitales, resultados recientes.",
    color: "border-green-200 dark:border-green-800",
  },
  {
    key: "assessment",
    label: "Evaluación (A)",
    hint: "Diagnóstico o impresión diagnóstica, evolución del cuadro.",
    color: "border-amber-200 dark:border-amber-800",
  },
  {
    key: "plan",
    label: "Plan (P)",
    hint: "Conducta terapéutica, indicaciones, seguimiento, interconsultas.",
    color: "border-purple-200 dark:border-purple-800",
  },
];

const AUTOSAVE_DELAY_MS = 30_000;

function draftKey(episodeId: string | undefined) {
  return `ece-evolucion-draft-${episodeId ?? "sin-episodio"}`;
}

function loadDraft(episodeId: string | undefined): SoapState {
  if (typeof window === "undefined") {
    return { subjective: "", objective: "", assessment: "", plan: "" };
  }
  try {
    const raw = localStorage.getItem(draftKey(episodeId));
    if (raw) return JSON.parse(raw) as SoapState;
  } catch {
    // corrupted draft — ignore
  }
  return { subjective: "", objective: "", assessment: "", plan: "" };
}

export default function NuevaEvolucionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const episodeId = searchParams.get("episodeId") ?? undefined;

  const [soap, setSoap] = React.useState<SoapState>(() =>
    loadDraft(episodeId),
  );
  const [confirmSignOpen, setConfirmSignOpen] = React.useState(false);
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [autosaveMsg, setAutosaveMsg] = React.useState<string | null>(null);

  const create = trpc.eceEvolucion.create.useMutation();
  const sign = trpc.eceEvolucion.sign.useMutation();
  const utils = trpc.useUtils();

  const isPending = create.isPending || sign.isPending;

  const set = (key: SoapKey, value: string) =>
    setSoap((prev) => ({ ...prev, [key]: value }));

  const hasContent =
    soap.subjective.trim() !== "" ||
    soap.objective.trim() !== "" ||
    soap.assessment.trim() !== "" ||
    soap.plan.trim() !== "";

  // Autosave a localStorage cada AUTOSAVE_DELAY_MS ms
  const autosaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(episodeId), JSON.stringify(soap));
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
  }, [soap, episodeId]);

  // Ctrl+S — guardar borrador local inmediatamente
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        try {
          localStorage.setItem(draftKey(episodeId), JSON.stringify(soap));
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
  }, [soap, episodeId]);

  function clearDraft() {
    try {
      localStorage.removeItem(draftKey(episodeId));
    } catch {
      // ignore
    }
  }

  async function persistCreate(): Promise<{ id: string } | null> {
    setPageError(null);
    try {
      const r = await create.mutateAsync({
        episodeId: episodeId ?? "",
        subjective: soap.subjective.trim() || undefined,
        objective: soap.objective.trim() || undefined,
        assessment: soap.assessment.trim() || undefined,
        plan: soap.plan.trim() || undefined,
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
    utils.eceEvolucion.list.invalidate({ episodeId });
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
      utils.eceEvolucion.list.invalidate({ episodeId });
      router.replace(`/ece/evolucion/${created.id}`);
    } catch (e) {
      setPageError(
        `Evolución guardada como borrador, pero falló la firma: ${
          e instanceof Error ? e.message : "error"
        }. Puedes firmar desde el listado.`,
      );
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva evolución médica</h1>
        <p className="text-sm text-muted-foreground">
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
        <div className="grid gap-4 sm:grid-cols-2">
          {SOAP_FIELDS.map(({ key, label, hint, color }) => (
            <Card key={key} className={`border-l-4 ${color}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide">
                  <Label htmlFor={`soap-${key}`}>{label}</Label>
                </CardTitle>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </CardHeader>
              <CardContent>
                <textarea
                  id={`soap-${key}`}
                  name={key}
                  value={soap[key]}
                  onChange={(e) => set(key, e.target.value)}
                  rows={8}
                  placeholder={`Redactar ${label.toLowerCase()}…`}
                  aria-label={label}
                  className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </CardContent>
            </Card>
          ))}
        </div>

        {pageError ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {pageError}
          </div>
        ) : null}

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
              {create.isPending ? "Guardando…" : "Guardar borrador"}
            </Button>
            <Button
              type="button"
              onClick={() => setConfirmSignOpen(true)}
              disabled={isPending || !hasContent}
            >
              Firmar
            </Button>
          </div>
        </div>
      </form>

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
