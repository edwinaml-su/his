"use client";

/**
 * GS1 Trazabilidad de lote — §19 Inventario / GS1-128.
 *
 * Permite buscar un número de lote y ver:
 * - Timeline visual: recepción → almacenamiento → unidosis →
 *   dispensación → administración → paciente final.
 * - Lista de pacientes afectados (solo MRN — privacy LGPD/HIPAA §8.3).
 * - Botón "Iniciar recall" (requiere rol DIR).
 *
 * Estado actual: UI completa con datos de demostración y hooks de integración
 * preparados para conectar con `trpc.gs1.loteTrace` cuando el router esté
 * disponible (sprint GS1 fase 2).
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
  LotTraceTimeline,
  GS1_STEPS,
  type LotTraceStep,
} from "@/components/lot-trace-timeline";

// ─── Tipos de datos de respuesta ──────────────────────────────────────────

interface AffectedPatient {
  mrn: string;
  encounterId: string;
  administeredAt: string | null;
}

interface LotTraceResult {
  lotNumber: string;
  itemName: string;
  itemSku: string;
  expiryDate: string | null;
  quantityOnHand: number;
  steps: LotTraceStep[];
  affectedPatients: AffectedPatient[];
  recallInitiated: boolean;
}

// ─── Datos de demostración ────────────────────────────────────────────────
// Se reemplazan por trpc.gs1.loteTrace.useQuery({ lotNumber }) cuando
// el router esté disponible.

function buildDemoData(lotNumber: string): LotTraceResult {
  const base = new Date("2026-05-01T08:00:00-06:00");
  const add = (h: number) => new Date(base.getTime() + h * 3_600_000);

  const steps: LotTraceStep[] = GS1_STEPS.map((cfg, idx) => ({
    ...cfg,
    occurredAt: idx < 4 ? add(idx * 6) : null,
    reference:
      idx === 0
        ? `FAC-2026-04-${lotNumber.slice(-3)}`
        : idx === 1
          ? "BODEGA-A / EST-001"
          : idx === 3
            ? `RX-${lotNumber}-01`
            : undefined,
  }));

  return {
    lotNumber,
    itemName: "Amoxicilina 500 mg Cápsulas",
    itemSku: "MED-AMOX-500",
    expiryDate: "2027-03-31",
    quantityOnHand: 240,
    steps,
    affectedPatients: [
      { mrn: "PAC-000123", encounterId: "ENC-001", administeredAt: null },
      { mrn: "PAC-000456", encounterId: "ENC-002", administeredAt: null },
    ],
    recallInitiated: false,
  };
}

// ─── Componente ────────────────────────────────────────────────────────────

export default function LotTracePage() {
  const params = useParams<{ lote: string }>();
  const lotNumber = decodeURIComponent(params.lote ?? "");

  // TODO: reemplazar con trpc.gs1.loteTrace.useQuery({ lotNumber }) cuando
  // el router esté implementado.
  const data = React.useMemo(() => buildDemoData(lotNumber), [lotNumber]);

  const [recallPending, setRecallPending] = React.useState(false);
  const [recallDone, setRecallDone] = React.useState(data.recallInitiated);

  function handleRecall() {
    setRecallPending(true);
    // TODO: conectar a trpc.gs1.initiateRecall.mutate({ lotNumber })
    setTimeout(() => {
      setRecallPending(false);
      setRecallDone(true);
    }, 800);
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

        <Button
          variant={recallDone ? "outline" : "destructive"}
          disabled={recallPending || recallDone}
          aria-label={
            recallDone
              ? "Recall ya iniciado"
              : "Iniciar recall — requiere autorización DIR"
          }
          data-testid="btn-iniciar-recall"
          onClick={handleRecall}
        >
          {recallDone
            ? "Recall iniciado"
            : recallPending
              ? "Iniciando…"
              : "Iniciar recall"}
        </Button>
      </div>

      {/* Tarjeta resumen del lote */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Información del lote</CardTitle>
        </CardHeader>
        <CardContent>
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
                {data.lotNumber}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Producto
              </dt>
              <dd className="mt-0.5" data-testid="lot-item-name">
                {data.itemName}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                SKU
              </dt>
              <dd className="mt-0.5 font-mono">{data.itemSku}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Vencimiento
              </dt>
              <dd className="mt-0.5">{data.expiryDate ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Stock disponible
              </dt>
              <dd className="mt-0.5">{data.quantityOnHand} unidades</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Estado recall
              </dt>
              <dd className="mt-0.5">
                {recallDone ? (
                  <Badge variant="destructive" data-testid="badge-recall">
                    Recall activo
                  </Badge>
                ) : (
                  <Badge variant="secondary" data-testid="badge-recall">
                    Normal
                  </Badge>
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cadena de custodia</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            aria-live="polite"
            aria-label="Línea de tiempo de trazabilidad del lote"
          >
            <LotTraceTimeline steps={data.steps} />
          </div>
        </CardContent>
      </Card>

      {/* Pacientes afectados */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pacientes afectados
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (solo MRN — privacidad §8.3)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.affectedPatients.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Sin pacientes registrados para este lote.
            </p>
          ) : (
            <ul
              className="divide-y divide-border"
              aria-label="Pacientes afectados por el lote"
              data-testid="affected-patients-list"
            >
              {data.affectedPatients.map((p) => (
                <li
                  key={p.encounterId}
                  className="flex items-center justify-between py-2.5 text-sm"
                  data-testid={`patient-row-${p.mrn}`}
                >
                  <span className="font-mono font-medium">{p.mrn}</span>
                  <span className="text-xs text-muted-foreground">
                    Episodio: {p.encounterId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.administeredAt
                      ? `Adm: ${p.administeredAt}`
                      : "Sin administración registrada"}
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
