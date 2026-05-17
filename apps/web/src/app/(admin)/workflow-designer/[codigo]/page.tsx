"use client";

/**
 * Workflow Designer — Vista de grafo del workflow de un tipo de documento.
 *
 * Layout:
 *  - Sección superior: nombre y badges del tipo de documento.
 *  - Grafo ReactFlow: nodos custom por tipo, drag-drop, sidebar de detalles.
 *  - Panel lateral derecho: matriz documento_rol (LLENA/RESPONSABLE/AUTORIZA/FIRMA × rol).
 *  - Botón "Editar workflow" → /workflow-designer/[codigo]/editar.
 *
 * Accesibilidad (WCAG 2.2 AA):
 *  - Nodos con aria-label descriptivo.
 *  - La tabla de roles tiene encabezados apropiados.
 *  - Navegación por teclado: nodos focusables con Enter/Space para abrir sidebar.
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
import { WorkflowGraph } from "./_components/workflow-graph";

// ─── Constantes ───────────────────────────────────────────────────────────────

const FUNCION_LABELS: Record<string, string> = {
  LLENA: "Llena",
  RESPONSABLE: "Responsable",
  AUTORIZA: "Autoriza",
  FIRMA: "Firma",
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
              <WorkflowGraph
                estados={estados ?? []}
                transiciones={transiciones ?? []}
                tipDocCodigo={codigo}
                workflowEditHref={`/workflow-designer/${codigo}/editar`}
              />
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
