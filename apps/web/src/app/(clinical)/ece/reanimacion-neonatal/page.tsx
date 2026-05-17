"use client";

/**
 * ECE — Reanimación Neonatal NRP (AHA/AAP).
 * Timeline de pasos + flowchart del algoritmo como cards expandibles.
 * Filtro por atencion_rn_id (UUID de ece.documentos_obstetricos).
 */
import * as React from "react";
import { HeartHandshake, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";
import { NrpTimeline } from "./_components/nrp-timeline";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const RESULTADO_LABEL: Record<string, string> = {
  estable: "Estable",
  cuidados_intermedios: "Cuidados intermedios",
  ucin: "UCIN",
  defuncion: "Defunción",
};

const RESULTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  estable: "default",
  cuidados_intermedios: "secondary",
  ucin: "outline",
  defuncion: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

// ---------------------------------------------------------------------------
// Pasos del algoritmo NRP (referencia clínica)
// ---------------------------------------------------------------------------

interface AlgoStep {
  paso: number;
  titulo: string;
  descripcion: string;
  accion: string;
  criterio: string;
}

const NRP_STEPS: AlgoStep[] = [
  {
    paso: 1,
    titulo: "Evaluación inicial",
    descripcion: "¿A término? ¿Tono? ¿Respiración o llanto?",
    accion: "Calor, posición, limpiar vía aérea, secar, estimular.",
    criterio: "Si todas respuestas sí → cuidados rutinarios.",
  },
  {
    paso: 2,
    titulo: "Estimulación táctil",
    descripcion: "30 s de pasos iniciales. Evaluar FC y respiración.",
    accion: "Secar, reposicionar, limpiar secreciones, estimular táctilmente.",
    criterio: "FC < 100 o apnea → iniciar VPP.",
  },
  {
    paso: 3,
    titulo: "Ventilación con Presión Positiva (VPP)",
    descripcion: "VPP a 40–60 resp/min. Objetivo SpO₂ por minuto.",
    accion: "Bolsa-mascarilla o CPAP. Confirmar elevación de tórax.",
    criterio: "FC < 60 tras 30 s VPP correcta → intubación + MCE.",
  },
  {
    paso: 4,
    titulo: "Intubación endotraqueal",
    descripcion: "Indicada si VPP inefectiva o reanimación prolongada.",
    accion: "Intubación orotraqueal + confirmar con capnografía o Rx.",
    criterio: "FC < 60 con VPP e intubación → MCE.",
  },
  {
    paso: 5,
    titulo: "Masaje Cardíaco Externo (MCE)",
    descripcion: "Relación 3:1 con VPP. Tercio inferior del esternón.",
    accion: "Dos pulgares o dos dedos. 90 compresiones + 30 ventilaciones/min.",
    criterio: "FC < 60 tras 45–60 s MCE + VPP → adrenalina.",
  },
  {
    paso: 6,
    titulo: "Medicación: Adrenalina / Expansores",
    descripcion: "Adrenalina IV/UE 0.01–0.03 mg/kg. Expansores si hipovolemia.",
    accion: "Adrenalina 1:10.000 IV umbilical. Expansor: SSN 0.9% o sangre 10 ml/kg.",
    criterio: "Documentar dosis y hora. Reevaluar FC cada 60 s.",
  },
];

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function ReanimacionNeonatalPage() {
  const [atencionRnId, setAtencionRnId] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const query = trpc.eceReanimacionNeonatal.list.useQuery(
    { atencionRnId: atencionRnId.trim() || undefined, page: 1, pageSize: 50 },
    { enabled: true },
  );

  const detailQuery = trpc.eceReanimacionNeonatal.get.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId },
  );

  const rows = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <HeartHandshake className="h-6 w-6" aria-hidden />
            Reanimación Neonatal NRP
          </h1>
          <p className="text-sm text-muted-foreground">
            Protocolo AHA/AAP — Pasos timestamped y resultado clínico. Cat-E.
          </p>
        </div>
      </div>

      {/* Filtro */}
      <Card>
        <CardHeader>
          <CardTitle>Filtrar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="filter-atencion">Atención RN (UUID de documentos obstétricos)</Label>
            <Input
              id="filter-atencion"
              placeholder="xxxxxxxx-xxxx-..."
              value={atencionRnId}
              onChange={(e) => setAtencionRnId(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Lista de registros */}
      <Card>
        <CardHeader>
          <CardTitle>Registros NRP ({query.data?.total ?? "…"})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {query.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {!query.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin registros NRP.</p>
          )}
          {rows.map((r) => {
            const isOpen = selectedId === r.id;
            const cerrado = r.cerrado_en !== null;

            return (
              <div key={r.id} className="rounded-md border">
                <button
                  type="button"
                  onClick={() => setSelectedId(isOpen ? null : r.id)}
                  className="flex w-full items-center justify-between p-3 text-left hover:bg-muted/50"
                  aria-expanded={isOpen}
                >
                  <div className="flex items-center gap-3">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {r.id.slice(0, 8)}…
                      </p>
                      <p className="text-sm font-medium">
                        ATN-RN: {r.atencion_rn_id.slice(0, 8)}…
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.resultado && (
                      <Badge variant={RESULTADO_VARIANT[r.resultado] ?? "outline"}>
                        {RESULTADO_LABEL[r.resultado] ?? r.resultado}
                      </Badge>
                    )}
                    <Badge variant={cerrado ? "secondary" : "default"}>
                      {cerrado ? "Cerrado" : "En curso"}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                      <Clock className="h-3 w-3" aria-hidden />
                      {dateFmt.format(new Date(r.apertura_en))}
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t p-4">
                    {detailQuery.isLoading && (
                      <p className="text-sm text-muted-foreground">Cargando detalle…</p>
                    )}
                    {detailQuery.data && <NrpTimeline record={detailQuery.data} />}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Algoritmo NRP — referencia rápida */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartHandshake className="h-4 w-4" aria-hidden />
            Algoritmo NRP (AHA/AAP) — referencia rápida
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <NrpAlgorithmCards />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards expandibles del algoritmo NRP
// ---------------------------------------------------------------------------

function NrpAlgorithmCards() {
  const [openStep, setOpenStep] = React.useState<number | null>(null);

  return (
    <>
      {NRP_STEPS.map((step) => {
        const isOpen = openStep === step.paso;
        return (
          <div key={step.paso} className="rounded-md border">
            <button
              type="button"
              onClick={() => setOpenStep(isOpen ? null : step.paso)}
              className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
              aria-expanded={isOpen}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {step.paso}
              </span>
              <span className="font-medium">{step.titulo}</span>
              <span className="ml-auto">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </span>
            </button>
            {isOpen && (
              <div className="space-y-2 border-t p-4 text-sm">
                <p className="text-muted-foreground">{step.descripcion}</p>
                <p>
                  <span className="font-semibold">Acción: </span>
                  {step.accion}
                </p>
                <p>
                  <span className="font-semibold">Criterio de avance: </span>
                  {step.criterio}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
