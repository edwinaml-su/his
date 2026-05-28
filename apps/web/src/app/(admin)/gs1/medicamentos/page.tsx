"use client";

/**
 * US.F2.6.4 — Medicamentos GTIN catalog.
 *
 * Tabla con filtros de recall y vencimientos próximos.
 * Row con recall activo muestra badge rojo.
 * Click en fila abre MedicationForm (edición avanzada).
 */

import * as React from "react";
import { Pill, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { MedicationForm } from "./_components/medication-form";
import { RecallBanner } from "./_components/recall-banner";

// ---------------------------------------------------------------------------
// Tipos de datos del router
// ---------------------------------------------------------------------------

type RecallStatus = "NONE" | "ALERTA" | "RECALL_VOLUNTARIO" | "RECALL_REGULATORIO";

interface MedicationItem {
  id: string;
  codigo: string;
  descripcion: string;
  fabricante: string;
  presentacion: string;
  contenidoUnidades: number;
  principioActivo: string | null;
  codigoAtc: string | null;
  activo: boolean;
  creadoEn: Date;
  principiosActivos: string[];
  excipientesAlergenos: string[];
  recallStatus: RecallStatus;
  recallMotivo: string | null;
  recallFecha: Date | null;
  loteVencimiento: Date | null;
}

const RECALL_LABELS: Record<RecallStatus, string> = {
  NONE:               "Todos",
  ALERTA:             "Alerta",
  RECALL_VOLUNTARIO:  "Recall voluntario",
  RECALL_REGULATORIO: "Recall regulatorio",
};

const RECALL_BADGE_VARIANT: Record<RecallStatus, "default" | "secondary" | "destructive" | "outline"> = {
  NONE:               "secondary",
  ALERTA:             "outline",
  RECALL_VOLUNTARIO:  "destructive",
  RECALL_REGULATORIO: "destructive",
};

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function MedicamentosPage() {
  const [selectedId, setSelectedId]       = React.useState<string | null>(null);
  const [editOpen, setEditOpen]           = React.useState(false);
  const [recallFilter, setRecallFilter]   = React.useState<RecallStatus | "">("");
  const [vencFilter, setVencFilter]       = React.useState<number | undefined>(undefined);

  const { data: items, isLoading, isError } = trpc.gs1Medication.list.useQuery(
    {
      recallStatus:     (recallFilter as RecallStatus) || undefined,
      vencimientosDias: vencFilter,
      limit: 100,
      offset: 0,
    },
    { staleTime: 20_000 },
  );

  const { data: detail } = trpc.gs1Medication.get.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId, staleTime: 15_000 },
  );

  const utils = trpc.useUtils();
  const markRecallMutation = trpc.gs1Medication.markRecall.useMutation({
    onSuccess: () => void utils.gs1Medication.list.invalidate(),
  });

  const hasRecallItems = items?.some((i) => i.recallStatus !== "NONE") ?? false;

  function openEdit(item: MedicationItem) {
    setSelectedId(item.id);
    setEditOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Medicamentos GTIN</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo GS1-14 con principios activos, excipientes alergénicos y control de recall.
          </p>
        </div>

        {hasRecallItems && (
          <div className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>Hay medicamentos con recall activo</span>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Estado recall:</span>
          <Select
            value={recallFilter || "all"}
            onValueChange={(v) =>
              setRecallFilter(v === "all" ? "" : (v as RecallStatus))
            }
          >
            <SelectTrigger className="w-[180px]" data-testid="filter-recall">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              {/* Radix Select prohíbe value="" — centinela "all". */}
              <SelectItem value="all">Todos</SelectItem>
              {(["ALERTA", "RECALL_VOLUNTARIO", "RECALL_REGULATORIO"] as RecallStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{RECALL_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Vencimiento en:</span>
          <Select
            value={vencFilter?.toString() ?? "all"}
            onValueChange={(v) =>
              setVencFilter(v === "all" ? undefined : parseInt(v, 10))
            }
          >
            <SelectTrigger className="w-[140px]" data-testid="filter-vencimiento">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="7">7 días</SelectItem>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="90">90 días</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabla */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Catálogo
            {items && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({items.length} registros)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground" role="status">
              Cargando medicamentos…
            </p>
          )}
          {isError && (
            <p className="py-8 text-center text-sm text-destructive" role="alert">
              Error al cargar el catálogo.
            </p>
          )}
          {!isLoading && !isError && items && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8">
              <Pill className="mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Sin medicamentos que coincidan con los filtros aplicados.
              </p>
            </div>
          )}
          {!isLoading && !isError && items && items.length > 0 && (
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                aria-label="Catálogo de medicamentos GTIN"
              >
                <thead>
                  <tr className="border-b text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 text-left">GTIN-14</th>
                    <th className="py-2 text-left">Descripción</th>
                    <th className="py-2 text-left">Fabricante</th>
                    <th className="py-2 text-left">ATC</th>
                    <th className="py-2 text-left">Vencimiento</th>
                    <th className="py-2 text-left">Recall</th>
                    <th className="py-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="transition-colors hover:bg-accent/30"
                      data-testid={`med-row-${item.id}`}
                    >
                      <td className="py-2.5 font-mono text-xs">{item.codigo}</td>
                      <td className="py-2.5">
                        <div className="font-medium">{item.descripcion}</div>
                        {item.principioActivo && (
                          <div className="text-xs text-muted-foreground">{item.principioActivo}</div>
                        )}
                        {item.excipientesAlergenos.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {item.excipientesAlergenos.slice(0, 3).map((exc) => (
                              <Badge
                                key={exc}
                                variant="outline"
                                className="text-[10px] px-1 py-0 text-orange-700 border-orange-300"
                              >
                                {exc}
                              </Badge>
                            ))}
                            {item.excipientesAlergenos.length > 3 && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                +{item.excipientesAlergenos.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground">{item.fabricante}</td>
                      <td className="py-2.5 font-mono text-xs">{item.codigoAtc ?? "—"}</td>
                      <td className="py-2.5 text-xs">
                        {item.loteVencimiento ? (
                          <span
                            className={
                              new Date(item.loteVencimiento) <= new Date(Date.now() + 30 * 86400000)
                                ? "font-medium text-destructive"
                                : "text-muted-foreground"
                            }
                          >
                            {new Date(item.loteVencimiento).toLocaleDateString("es-SV")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <Badge
                          variant={RECALL_BADGE_VARIANT[item.recallStatus]}
                          className="text-[10px]"
                          data-testid={`badge-recall-${item.id}`}
                        >
                          {item.recallStatus === "NONE" ? "Normal" : RECALL_LABELS[item.recallStatus]}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(item)}
                          data-testid={`btn-editar-${item.id}`}
                        >
                          Editar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog edición */}
      {detail && editOpen && (
        <>
          {detail.recallStatus !== "NONE" && (
            <RecallBanner
              recallStatus={detail.recallStatus}
              recallMotivo={detail.recallMotivo}
              recallFecha={detail.recallFecha}
            />
          )}
          <MedicationForm
            open={editOpen}
            onOpenChange={(open) => {
              setEditOpen(open);
              if (!open) setSelectedId(null);
            }}
            medication={detail}
          />
        </>
      )}
    </div>
  );
}
