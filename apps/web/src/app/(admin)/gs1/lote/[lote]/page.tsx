"use client";

/**
 * GS1 Trazabilidad de lote — §19 Inventario / GS1-128.
 *
 * Permite buscar un número de lote y ver:
 * - Información del GTIN (catálogo ECE).
 * - Timeline de movimientos (EPCIS) + recepciones.
 * - Lista de dispensaciones (solo ID paciente — privacidad LGPD/HIPAA §8.3).
 * - Botón "Iniciar recall" (requiere rol ADMIN/DIRECTOR — HI-11).
 *
 * WCAG 2.2 AA: tokens semánticos, foco visible, aria-live para resultados,
 * contraste mínimo 4.5:1 (muted-foreground sobre background).
 */
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@his/ui/components/dialog";
import {
  LotTraceTimeline,
  GS1_STEPS,
  type LotTraceStep,
} from "@/components/lot-trace-timeline";
import { trpc } from "@/lib/trpc/react";

/**
 * Construye los pasos de la timeline a partir de los movimientos EPCIS.
 * Mapea subtipos conocidos a los GS1_STEPS del componente legacy.
 * Si no hay movimientos, devuelve los steps con occurredAt null.
 */
function buildStepsFromMovimientos(
  movimientos: Array<{ fecha: Date; tipo: string; ubicacion: unknown; cantidad: unknown | null }>,
): LotTraceStep[] {
  const subtipoToStepIndex: Record<string, number> = {
    INBOUND:           0,
    STORAGE:           1,
    PHARMACY_DISPENSE: 2,
    BEDSIDE_ADMIN:     3,
    RETURNING:         4,
  };

  return GS1_STEPS.map((cfg, idx) => {
    const movimiento = movimientos.find(
      (m) => (subtipoToStepIndex[m.tipo] ?? -1) === idx,
    );
    return {
      ...cfg,
      occurredAt: movimiento ? movimiento.fecha : null,
    } as LotTraceStep;
  });
}

// ─── Formulario de recall ─────────────────────────────────────────────────────

type SeveridadRecall = "VOLUNTARIO" | "OBLIGATORIO" | "RETIRO_MERCADO";

interface RecallFormState {
  motivo: string;
  severidad: SeveridadRecall;
}

// ─── Componente ────────────────────────────────────────────────────────────────

export default function LotTracePage() {
  const params = useParams<{ lote: string }>();
  const lotNumber = decodeURIComponent(params.lote ?? "");

  // ── Query trazabilidad ──────────────────────────────────────────────────────
  const { data, isLoading, isError, error } =
    trpc.gs1LoteTrace.loteTrace.useQuery(
      { lotNumber },
      { enabled: lotNumber.length > 0 },
    );

  // ── Mutation recall ─────────────────────────────────────────────────────────
  const utils = trpc.useUtils();
  const [recallOpen, setRecallOpen] = React.useState(false);
  const [recallForm, setRecallForm] = React.useState<RecallFormState>({
    motivo: "",
    severidad: "VOLUNTARIO",
  });

  const recallMutation = trpc.gs1LoteTrace.initiateRecall.useMutation({
    onSuccess: () => {
      setRecallOpen(false);
      void utils.gs1LoteTrace.loteTrace.invalidate({ lotNumber });
    },
  });

  // ── Estados derivados ───────────────────────────────────────────────────────
  const recallStatus = data?.gtin?.recallStatus ?? "NONE";
  const recallActivo = recallStatus !== "NONE" && recallStatus !== "CERRADO";
  const steps = React.useMemo(
    () => buildStepsFromMovimientos(data?.movimientos ?? []),
    [data?.movimientos],
  );

  // ── Render estados de carga ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="py-12 text-center text-sm text-muted-foreground">
        Cargando trazabilidad del lote…
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="py-12 text-center text-sm text-destructive">
        Error al cargar datos: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold leading-tight">
            Trazabilidad de lote
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            GS1-128 / §19 Inventario — búsqueda por número de lote
          </p>
        </div>

        {/* Botón recall — visible para todos; el server enforza rol ADMIN/DIRECTOR (HI-11) */}
        <Dialog open={recallOpen} onOpenChange={setRecallOpen}>
            <DialogTrigger asChild>
              <Button
                variant={recallActivo ? "outline" : "destructive"}
                disabled={recallActivo}
                aria-label={
                  recallActivo
                    ? `Recall activo (estado: ${recallStatus})`
                    : "Iniciar proceso de recall — requiere autorización ADMIN o DIRECTOR"
                }
                data-testid="btn-iniciar-recall"
              >
                {recallActivo ? `Recall: ${recallStatus}` : "Iniciar recall"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Iniciar proceso de recall</DialogTitle>
                <DialogDescription>
                  Esta acción marcará el GTIN como recall activo y emitirá una
                  notificación. Requiere autorización de nivel DIRECTOR o
                  ADMIN.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Severidad</span>
                  <select
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={recallForm.severidad}
                    onChange={(e) =>
                      setRecallForm((f) => ({
                        ...f,
                        severidad: e.target.value as SeveridadRecall,
                      }))
                    }
                  >
                    <option value="VOLUNTARIO">Voluntario</option>
                    <option value="OBLIGATORIO">Obligatorio (MINSAL)</option>
                    <option value="RETIRO_MERCADO">Retiro de mercado</option>
                  </select>
                </label>

                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">Motivo</span>
                  <textarea
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    rows={4}
                    placeholder="Describe el motivo del recall (mínimo 10 caracteres)…"
                    value={recallForm.motivo}
                    onChange={(e) =>
                      setRecallForm((f) => ({ ...f, motivo: e.target.value }))
                    }
                  />
                </label>

                {recallMutation.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {recallMutation.error.message}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setRecallOpen(false)}
                  disabled={recallMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    recallMutation.isPending ||
                    recallForm.motivo.length < 10 ||
                    !data?.gtin?.id
                  }
                  onClick={() => {
                    if (!data?.gtin?.id) return;
                    recallMutation.mutate({
                      gtinId:    data.gtin.id,
                      motivo:    recallForm.motivo,
                      severidad: recallForm.severidad,
                    });
                  }}
                  data-testid="btn-confirmar-recall"
                >
                  {recallMutation.isPending ? "Iniciando…" : "Confirmar recall"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
      </div>

      {/* Tarjeta resumen del lote */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Información del lote</CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.gtin ? (
            <p className="text-sm text-muted-foreground" role="status">
              No se encontró un GTIN registrado para el lote{" "}
              <span className="font-mono">{lotNumber}</span>.
            </p>
          ) : (
            <dl
              className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4"
              aria-label="Datos del lote"
            >
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Lote
                </dt>
                <dd
                  className="mt-0.5 font-mono font-semibold"
                  data-testid="lot-number"
                >
                  {lotNumber}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  GTIN
                </dt>
                <dd className="mt-0.5 font-mono">{data.gtin.codigo}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Producto
                </dt>
                <dd className="mt-0.5" data-testid="lot-item-name">
                  {data.gtin.descripcion}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Fabricante
                </dt>
                <dd className="mt-0.5">{data.gtin.fabricante || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Estado recall
                </dt>
                <dd className="mt-0.5">
                  {recallActivo ? (
                    <Badge variant="destructive" data-testid="badge-recall">
                      {recallStatus}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" data-testid="badge-recall">
                      Normal
                    </Badge>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Timeline cadena de custodia */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cadena de custodia</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            aria-live="polite"
            aria-label="Línea de tiempo de trazabilidad del lote"
          >
            <LotTraceTimeline steps={steps} />
          </div>
        </CardContent>
      </Card>

      {/* Dispensaciones */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Dispensaciones registradas
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (solo ID paciente — privacidad §8.3)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.dispensaciones.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Sin dispensaciones registradas para este lote.
            </p>
          ) : (
            <ul
              className="divide-y divide-border"
              aria-label="Dispensaciones del lote"
              data-testid="dispensaciones-list"
            >
              {data.dispensaciones.map((d, idx) => (
                <li
                  key={`${d.paciente_id ?? "anonimo"}-${idx}`}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <span className="font-mono font-medium">
                    {d.paciente_id ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Prescripción: {d.prescripcion_id ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {d.fecha instanceof Date
                      ? d.fecha.toLocaleDateString("es-SV")
                      : String(d.fecha)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
