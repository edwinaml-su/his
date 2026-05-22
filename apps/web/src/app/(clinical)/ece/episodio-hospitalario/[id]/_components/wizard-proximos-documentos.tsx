"use client";

/**
 * WizardProximosDocumentos — Fase 5 del workflow-designer enhancement.
 *
 * Muestra al equipo clínico la lista ordenada de documentos NTEC que tocan
 * llenar/firmar en un episodio, calculada server-side desde
 * `tipo_documento.depende_de` y las instancias ya creadas.
 *
 * Clasificación:
 *   - LISTO         → verde, botón "Iniciar"
 *   - EN_PROGRESO   → ámbar, botón "Continuar"
 *   - BLOQUEADO     → rojo, muestra dependencias faltantes
 *   - FIRMADO       → gris colapsable (al fondo)
 *
 * UX:
 *   - Sticky resumen con badges de conteo.
 *   - Botones deeplinkean al `moduloHisTarget` del tipo de documento.
 *   - Aria-labels descriptivos por estado.
 */
import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Lock,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

type EstadoWizard = "LISTO" | "EN_PROGRESO" | "BLOQUEADO" | "FIRMADO" | "NO_APLICA";

interface WizardItem {
  tipoId: string;
  codigo: string;
  nombre: string;
  modalidad: string;
  tipoRegistro: string;
  inmutable: boolean;
  moduloHisTarget: string | null;
  dependeDe: string[];
  dependenciasFaltantes: string[];
  instanciaId: string | null;
  estadoActual: string | null;
  estado: EstadoWizard;
}

const ESTADO_META: Record<
  EstadoWizard,
  {
    label: string;
    badgeVariant: "default" | "secondary" | "outline" | "destructive";
    icon: typeof CheckCircle2;
    bgClass: string;
    actionLabel: string;
  }
> = {
  LISTO: {
    label: "Listo para iniciar",
    badgeVariant: "default",
    icon: Sparkles,
    bgClass: "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-900/10",
    actionLabel: "Iniciar",
  },
  EN_PROGRESO: {
    label: "En progreso",
    badgeVariant: "secondary",
    icon: Clock,
    bgClass: "border-amber-300 bg-amber-50/50 dark:bg-amber-900/10",
    actionLabel: "Continuar",
  },
  BLOQUEADO: {
    label: "Bloqueado",
    badgeVariant: "destructive",
    icon: Lock,
    bgClass: "border-destructive/30 bg-destructive/5",
    actionLabel: "Bloqueado",
  },
  FIRMADO: {
    label: "Firmado",
    badgeVariant: "outline",
    icon: CheckCircle2,
    bgClass: "border-muted bg-muted/30 opacity-75",
    actionLabel: "Ver",
  },
  NO_APLICA: {
    label: "No aplica",
    badgeVariant: "outline",
    icon: AlertCircle,
    bgClass: "border-muted bg-muted/10 opacity-50",
    actionLabel: "—",
  },
};

interface WizardProximosDocumentosProps {
  episodioAtencionId: string;
}

export function WizardProximosDocumentos({
  episodioAtencionId,
}: WizardProximosDocumentosProps) {
  const { data, isLoading, error } =
    trpc.workflowInstance.proximosDocumentos.useQuery(
      { episodioId: episodioAtencionId },
      { enabled: !!episodioAtencionId },
    );

  const [mostrarFirmados, setMostrarFirmados] = React.useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="h-24 animate-pulse rounded bg-muted" aria-hidden />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error al cargar próximos documentos</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">
            No hay tipos de documento configurados para la modalidad{" "}
            <strong>{data?.modalidad ?? "—"}</strong>.
          </p>
        </CardContent>
      </Card>
    );
  }

  const activos = data.items.filter(
    (i) => i.estado !== "FIRMADO" && i.estado !== "NO_APLICA",
  );
  const firmados = data.items.filter((i) => i.estado === "FIRMADO");

  return (
    <div className="space-y-3">
      {/* Resumen con badges de conteo */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              Próximos documentos del episodio
              <span className="ml-2 font-normal text-muted-foreground">
                ({data.modalidad})
              </span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-xs">
          <Badge variant="default" className="gap-1">
            <Sparkles className="h-3 w-3" aria-hidden />
            {data.resumen.listos} listo{data.resumen.listos !== 1 ? "s" : ""}
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" aria-hidden />
            {data.resumen.enProgreso} en progreso
          </Badge>
          <Badge variant="destructive" className="gap-1">
            <Lock className="h-3 w-3" aria-hidden />
            {data.resumen.bloqueados} bloqueado{data.resumen.bloqueados !== 1 ? "s" : ""}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {data.resumen.firmados} firmado{data.resumen.firmados !== 1 ? "s" : ""}
          </Badge>
        </CardContent>
      </Card>

      {/* Items activos (LISTO + EN_PROGRESO + BLOQUEADO) */}
      <ul className="space-y-2" aria-label="Documentos activos del episodio">
        {activos.map((item) => (
          <ItemCard key={item.tipoId} item={item} episodioId={episodioAtencionId} />
        ))}
      </ul>

      {/* Items firmados (colapsables al fondo) */}
      {firmados.length > 0 && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMostrarFirmados((v) => !v)}
            aria-expanded={mostrarFirmados}
            className="text-xs text-muted-foreground"
          >
            {mostrarFirmados ? "Ocultar" : "Mostrar"} {firmados.length} documento
            {firmados.length !== 1 ? "s" : ""} firmado{firmados.length !== 1 ? "s" : ""}
          </Button>
          {mostrarFirmados && (
            <ul className="mt-2 space-y-2" aria-label="Documentos firmados">
              {firmados.map((item) => (
                <ItemCard
                  key={item.tipoId}
                  item={item}
                  episodioId={episodioAtencionId}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ItemCard({
  item,
  episodioId,
}: {
  item: WizardItem;
  episodioId: string;
}) {
  const meta = ESTADO_META[item.estado];
  const Icon = meta.icon;

  // URL destino:
  //  - moduloHisTarget definido → deeplink con ?episodioId= (preserva query existente)
  //  - sin módulo → fallback a workflow-designer del tipo (vista del flujo)
  const href = item.moduloHisTarget
    ? `${item.moduloHisTarget}${item.moduloHisTarget.includes("?") ? "&" : "?"}episodioId=${encodeURIComponent(episodioId)}`
    : `/workflow-designer/${item.codigo}`;

  const interactable =
    item.estado !== "BLOQUEADO" && item.estado !== "NO_APLICA";

  return (
    <li className={`rounded-md border p-3 ${meta.bgClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold">{item.codigo}</span>
              <Badge variant={meta.badgeVariant} className="text-[10px]">
                {meta.label}
              </Badge>
              {item.inmutable && (
                <Badge variant="outline" className="text-[10px]">
                  inmutable
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm">{item.nombre}</p>
            {item.estado === "BLOQUEADO" && item.dependenciasFaltantes.length > 0 && (
              <p className="mt-1 text-xs text-destructive">
                Requiere firmar primero:{" "}
                <span className="font-mono">
                  {item.dependenciasFaltantes.join(", ")}
                </span>
              </p>
            )}
            {item.estadoActual && item.estado !== "FIRMADO" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Estado actual:{" "}
                <span className="font-mono">{item.estadoActual}</span>
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {interactable ? (
            <Button
              asChild
              size="sm"
              variant={item.estado === "LISTO" ? "default" : "outline"}
              className="h-7 px-3 text-xs"
            >
              <Link
                href={href}
                aria-label={`${meta.actionLabel} ${item.nombre}`}
              >
                {meta.actionLabel}
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled
              className="h-7 px-3 text-xs"
              aria-label={`${item.nombre} bloqueado`}
            >
              {meta.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
