"use client";

/**
 * Workflow Designer — Vista de grafo del workflow de un tipo de documento.
 *
 * Layout:
 *  - Sección superior: nombre y badges del tipo de documento.
 *  - Grafo SVG (fallback — react-flow no instalado):
 *      Nodos = estados (badge INICIAL / FINAL / INTERMEDIO, ordenados por `orden`).
 *      Aristas = transiciones (etiqueta = accion + rol_autoriza.codigo).
 *  - Panel lateral derecho: matriz documento_rol (LLENA/RESPONSABLE/AUTORIZA/FIRMA × rol).
 *  - Botón "Editar workflow" → /workflow-designer/[codigo]/editar.
 *
 * Accesibilidad (WCAG 2.2 AA):
 *  - El grafo SVG incluye <title> y role="img" con aria-label.
 *  - La tabla de roles tiene encabezados apropiados.
 *  - Navegación por teclado: el botón Editar es enfocable y tiene label descriptivo.
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

// ─── Constantes ───────────────────────────────────────────────────────────────

const FUNCION_LABELS: Record<string, string> = {
  LLENA: "Llena",
  RESPONSABLE: "Responsable",
  AUTORIZA: "Autoriza",
  FIRMA: "Firma",
};

const ESTADO_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  inicial: "default",
  final: "secondary",
  intermedio: "outline",
};

// ─── Tipos raw ────────────────────────────────────────────────────────────────

interface EstadoRow {
  id: string;
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
}

interface TransicionRow {
  id: string;
  estado_origen_id: string;
  estado_destino_id: string;
  accion: string;
  requiere_firma: boolean;
  rol_codigo?: string;
}

interface RolRow {
  id: string;
  rol_id: string;
  funcion: string;
  obligatorio: boolean;
  rol_codigo?: string;
  rol_nombre?: string;
}

// ─── Grafo SVG ────────────────────────────────────────────────────────────────

/**
 * Grafo SVG simple de estados y transiciones.
 *
 * Layout: nodos en columna izquierda, flechas curvas hacia la derecha.
 * No usa react-flow (no instalado) — implementación mínima legible.
 *
 * Justificación heurística (Nielsen #4 — consistencia): usamos SVG nativo
 * sin dependencia extra para no bloquear el PR con cambios en package.json.
 */
function WorkflowGraph({
  estados,
  transiciones,
}: {
  estados: EstadoRow[];
  transiciones: TransicionRow[];
}) {
  const NODE_W = 140;
  const NODE_H = 44;
  const GAP_Y = 28;
  const MARGIN_X = 20;
  const MARGIN_Y = 20;
  const ARROW_X = MARGIN_X + NODE_W + 20; // espacio para etiquetas

  const sortedEstados = [...estados].sort((a, b) => a.orden - b.orden);
  const estadoPos: Record<string, { x: number; y: number }> = {};
  sortedEstados.forEach((e, i) => {
    estadoPos[e.id] = {
      x: MARGIN_X,
      y: MARGIN_Y + i * (NODE_H + GAP_Y),
    };
  });

  const svgH = MARGIN_Y * 2 + sortedEstados.length * (NODE_H + GAP_Y);
  const svgW = ARROW_X + 200;

  return (
    <svg
      role="img"
      aria-label="Grafo de estados y transiciones del workflow"
      viewBox={`0 0 ${svgW} ${svgH}`}
      width="100%"
      style={{ maxHeight: 480 }}
      className="overflow-visible"
    >
      <title>Grafo del workflow</title>

      {/* Flechas de transición */}
      {transiciones.map((t) => {
        const origen = estadoPos[t.estado_origen_id];
        const destino = estadoPos[t.estado_destino_id];
        if (!origen || !destino) return null;

        const x1 = origen.x + NODE_W;
        const y1 = origen.y + NODE_H / 2;
        const x2 = destino.x + NODE_W;
        const y2 = destino.y + NODE_H / 2;
        const mx = x1 + 40;
        const label = t.rol_codigo ? `${t.accion} (${t.rol_codigo})` : t.accion;

        return (
          <g key={t.id}>
            <path
              d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
            <text
              x={mx + 4}
              y={(y1 + y2) / 2 - 4}
              fontSize={10}
              fill="hsl(var(--muted-foreground))"
              className="select-none"
            >
              {label}
              {t.requiere_firma ? " ✎" : ""}
            </text>
          </g>
        );
      })}

      {/* Nodos de estado */}
      {sortedEstados.map((e) => {
        const pos = estadoPos[e.id]!;
        const kind = e.es_inicial ? "inicial" : e.es_final ? "final" : "intermedio";
        const fill =
          kind === "inicial"
            ? "hsl(var(--primary))"
            : kind === "final"
              ? "hsl(var(--secondary))"
              : "hsl(var(--card))";
        const textColor =
          kind === "inicial"
            ? "hsl(var(--primary-foreground))"
            : "hsl(var(--foreground))";

        return (
          <g key={e.id}>
            <rect
              x={pos.x}
              y={pos.y}
              width={NODE_W}
              height={NODE_H}
              rx={6}
              fill={fill}
              stroke="hsl(var(--border))"
              strokeWidth={1}
            />
            <text
              x={pos.x + NODE_W / 2}
              y={pos.y + NODE_H / 2 - 4}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fontWeight="600"
              fill={textColor}
              className="select-none"
            >
              {e.nombre}
            </text>
            <text
              x={pos.x + NODE_W / 2}
              y={pos.y + NODE_H / 2 + 10}
              textAnchor="middle"
              fontSize={9}
              fill={textColor}
              opacity={0.75}
              className="select-none"
            >
              {kind}
            </text>
          </g>
        );
      })}

      {/* Marcador de flecha */}
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--border))" />
        </marker>
      </defs>
    </svg>
  );
}

// ─── Matriz de roles ──────────────────────────────────────────────────────────

function MatrizRoles({ roles }: { roles: RolRow[] }) {
  const funciones = ["LLENA", "RESPONSABLE", "AUTORIZA", "FIRMA"] as const;

  // Agrupar por rol_codigo
  const rolesUnicos = Array.from(
    new Set(roles.map((r) => r.rol_codigo ?? r.rol_id)),
  );

  if (rolesUnicos.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">Sin roles asignados para este documento.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Rol</TableHead>
          {funciones.map((f) => (
            <TableHead key={f} className="text-center text-xs">
              {FUNCION_LABELS[f]}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rolesUnicos.map((rolCodigo) => {
          const rolesDeEsteRol = roles.filter(
            (r) => (r.rol_codigo ?? r.rol_id) === rolCodigo,
          );
          const rolNombre =
            rolesDeEsteRol[0]?.rol_nombre ?? rolCodigo;
          return (
            <TableRow key={rolCodigo}>
              <TableCell className="text-xs font-medium">
                <span className="block font-mono">{rolCodigo}</span>
                <span className="block text-muted-foreground">{rolNombre}</span>
              </TableCell>
              {funciones.map((f) => {
                const asig = rolesDeEsteRol.find((r) => r.funcion === f);
                return (
                  <TableCell key={f} className="text-center">
                    {asig ? (
                      <Badge
                        variant={asig.obligatorio ? "default" : "secondary"}
                        className="text-xs"
                        aria-label={`${rolCodigo} tiene función ${FUNCION_LABELS[f]}${asig.obligatorio ? " (obligatorio)" : " (opcional)"}`}
                      >
                        {asig.obligatorio ? "Si" : "Opt"}
                      </Badge>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        aria-label={`${rolCodigo} no tiene función ${FUNCION_LABELS[f]}`}
                      >
                        —
                      </span>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function WorkflowGrafoPage() {
  const params = useParams();
  const codigo = typeof params.codigo === "string" ? params.codigo : "";

  // Primero obtenemos el tipo de documento por código
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tiposDocs, isLoading: loadingDoc } = (trpc as any).workflowTipoDoc.list.useQuery(
    { soloActivos: false },
  );

  const tipoDoc = tiposDocs?.find(
    (d: { codigo: string }) => d.codigo === codigo,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: estados, isLoading: loadingEstados } = (trpc as any).workflowEstado.estado.list.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: transiciones, isLoading: loadingTransiciones } = (trpc as any).workflowEstado.transicion.list.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roles, isLoading: loadingRoles } = (trpc as any).workflowEstado.role.list.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  const isLoading = loadingDoc || loadingEstados || loadingTransiciones || loadingRoles;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" aria-hidden="true" />
        <div className="h-64 animate-pulse rounded bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (!tipoDoc) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Tipo de documento no encontrado</AlertTitle>
        <AlertDescription>
          No existe un tipo de documento con código <code>{codigo}</code>.{" "}
          <Link href="/workflow-designer" className="underline">
            Volver al listado
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{tipoDoc.nombre}</h1>
            {!tipoDoc.activo && (
              <Badge variant="outline">Inactivo</Badge>
            )}
          </div>
          <code className="text-xs text-muted-foreground">{tipoDoc.codigo}</code>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="secondary" className="text-xs">
              {tipoDoc.modalidad}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {tipoDoc.tipo_registro}
            </Badge>
            {tipoDoc.inmutable && (
              <Badge variant="secondary" className="text-xs">
                inmutable
              </Badge>
            )}
          </div>
        </div>
        <Button asChild>
          <Link
            href={`/workflow-designer/${codigo}/editar`}
            aria-label={`Editar workflow de ${tipoDoc.nombre}`}
          >
            Editar workflow
          </Link>
        </Button>
      </div>

      {/* Grafo + Matriz */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Grafo de estados y transiciones */}
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-sm">
              Estados y transiciones
              <span className="ml-2 font-normal text-muted-foreground">
                ({(estados ?? []).length} estados, {(transiciones ?? []).length} transiciones)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(estados ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin estados configurados. Usa{" "}
                <Link
                  href={`/workflow-designer/${codigo}/editar`}
                  className="underline"
                >
                  Editar workflow
                </Link>{" "}
                para agregar estados.
              </p>
            ) : (
              <>
                {/* Leyenda de badges */}
                <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {(["inicial", "final", "intermedio"] as const).map((kind) => (
                    <span key={kind} className="flex items-center gap-1">
                      <Badge
                        variant={ESTADO_BADGE_VARIANT[kind]}
                        className="text-xs"
                      >
                        {kind}
                      </Badge>
                    </span>
                  ))}
                  <span>✎ = requiere firma</span>
                </div>
                <WorkflowGraph
                  estados={estados ?? []}
                  transiciones={transiciones ?? []}
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* Matriz de roles */}
        <Card className="w-full lg:w-96">
          <CardHeader>
            <CardTitle className="text-sm">
              Matriz de roles funcionales
              <span className="ml-2 font-normal text-muted-foreground">
                (documento_rol)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <MatrizRoles roles={roles ?? []} />
          </CardContent>
        </Card>
      </div>

      {/* Breadcrumb / volver */}
      <p className="text-xs text-muted-foreground">
        <Link href="/workflow-designer" className="underline">
          Tipos de documento
        </Link>{" "}
        / {tipoDoc.nombre}
      </p>
    </div>
  );
}
