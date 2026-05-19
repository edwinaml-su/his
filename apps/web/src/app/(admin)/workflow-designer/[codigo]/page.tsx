"use client";

/**
 * Workflow Designer — Vista de grafo del workflow de un tipo de documento.
 *
 * Mejoras US.F2.2.14-17:
 *  - RBAC: solo WORKFLOW_DESIGNER / DIR / ADMIN pueden editar (US.F2.2.14).
 *  - Read-only mode: banner azul + paleta oculta + botones deshabilitados (US.F2.2.15).
 *  - Mobile: viewport < 768px muestra MobileView (lista de estados) (US.F2.2.16).
 *  - Accesibilidad WCAG 2.1 AA: skip-links, aria-labels, focus visible (US.F2.2.17).
 */
import * as React from "react";
import Link from "next/link";
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
import { useParams } from "next/navigation";
import { WorkflowGraph } from "./_components/workflow-graph";
import { MobileView } from "./_components/mobile-view";
import { ReadOnlyBanner } from "./_components/read-only-banner";
import { useWorkflowAccess } from "./_components/use-workflow-access";

// ─── Skip-links ───────────────────────────────────────────────────────────────

function SkipLinks() {
  return (
    <nav aria-label="Saltar al contenido" className="sr-only focus-within:not-sr-only">
      <ul className="flex gap-2 p-2 bg-primary text-primary-foreground">
        <li>
          <a
            href="#workflow-paleta"
            className="underline focus:outline-2 focus:outline-primary-foreground px-2 py-1 rounded"
          >
            Saltar a paleta
          </a>
        </li>
        <li>
          <a
            href="#workflow-canvas"
            className="underline focus:outline-2 focus:outline-primary-foreground px-2 py-1 rounded"
          >
            Saltar a canvas
          </a>
        </li>
        <li>
          <a
            href="#workflow-propiedades"
            className="underline focus:outline-2 focus:outline-primary-foreground px-2 py-1 rounded"
          >
            Saltar a propiedades
          </a>
        </li>
      </ul>
    </nav>
  );
}

// ─── Panel de validación ──────────────────────────────────────────────────────

interface ValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

function ValidationPanel({
  issues,
  onValidate,
  isLoading,
  tipoDocCodigo,
}: {
  issues: ValidationIssue[] | undefined;
  onValidate: () => void;
  isLoading: boolean;
  tipoDocCodigo: string;
}) {
  const errores = (issues ?? []).filter((i) => i.severity === "error");
  const warnings = (issues ?? []).filter((i) => i.severity === "warning");
  const badgeCount = errores.length + warnings.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            Validación de integridad
            {badgeCount > 0 && (
              <Badge
                variant={errores.length > 0 ? "destructive" : "outline"}
                className="ml-2 text-xs"
                aria-label={`${errores.length} errores, ${warnings.length} advertencias`}
              >
                {errores.length > 0 ? `${errores.length} error${errores.length > 1 ? "es" : ""}` : `${warnings.length} advertencia${warnings.length > 1 ? "s" : ""}`}
              </Badge>
            )}
            {issues !== undefined && badgeCount === 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                Valido
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onValidate}
            disabled={isLoading}
            aria-label="Validar integridad del workflow"
          >
            {isLoading ? "Validando..." : "Validar workflow"}
          </Button>
        </div>
      </CardHeader>
      {issues !== undefined && badgeCount > 0 && (
        <CardContent className="space-y-2">
          {errores.length > 0 && (
            <details open>
              <summary className="cursor-pointer select-none text-sm font-medium text-destructive">
                Errores ({errores.length})
              </summary>
              <ul className="mt-2 space-y-1" role="list" aria-label="Lista de errores de validación">
                {errores.map((issue) => (
                  <li
                    key={`${issue.code}-${issue.message}`}
                    className="flex items-start justify-between gap-2 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
                  >
                    <span>
                      <span className="mr-1 font-mono font-semibold text-destructive">
                        [{issue.code}]
                      </span>
                      {issue.message}
                    </span>
                    <Link
                      href={`/workflow-designer/${tipoDocCodigo}/editar`}
                      className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
                      aria-label={`Ir al editor para corregir: ${issue.message}`}
                    >
                      Ir al item
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {warnings.length > 0 && (
            <details open>
              <summary className="cursor-pointer select-none text-sm font-medium text-amber-600 dark:text-amber-400">
                Advertencias ({warnings.length})
              </summary>
              <ul className="mt-2 space-y-1" role="list" aria-label="Lista de advertencias de validación">
                {warnings.map((issue) => (
                  <li
                    key={`${issue.code}-${issue.message}`}
                    className="flex items-start justify-between gap-2 rounded border border-amber-300/40 bg-amber-50/50 px-3 py-2 text-xs dark:border-amber-700/30 dark:bg-amber-900/10"
                  >
                    <span>
                      <span className="mr-1 font-mono font-semibold text-amber-600 dark:text-amber-400">
                        [{issue.code}]
                      </span>
                      {issue.message}
                    </span>
                    <Link
                      href={`/workflow-designer/${tipoDocCodigo}/editar`}
                      className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
                      aria-label={`Ir al editor para revisar: ${issue.message}`}
                    >
                      Ir al item
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      )}
      {issues !== undefined && badgeCount === 0 && (
        <CardContent>
          <p className="text-xs text-muted-foreground">
            El workflow cumple todas las reglas de integridad.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

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
  const rolesUnicos = Array.from(new Set(roles.map((r) => r.rol_codigo ?? r.rol_id)));

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
          const rolesDeEsteRol = roles.filter((r) => (r.rol_codigo ?? r.rol_id) === rolCodigo);
          const rolNombre = rolesDeEsteRol[0]?.rol_nombre ?? rolCodigo;
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

// ─── Hook de detección de viewport móvil ─────────────────────────────────────

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function WorkflowGrafoPage() {
  const params = useParams();
  const codigo = typeof params.codigo === "string" ? params.codigo : "";
  const isMobile = useIsMobile();

  // TODO(HG-19): userAdmin.me no existe aún en el router — se necesita un
  // procedure que devuelva los roleCodes del usuario actual. Por ahora se
  // pasa array vacío y el acceso de edición queda deshabilitado hasta que
  // el backend implemente el endpoint.
  const roleCodes: string[] = [];
  const { canEdit, isReadOnly } = useWorkflowAccess(roleCodes);

  const { data: tiposDocs, isLoading: loadingDoc } = trpc.workflowTipoDoc.list.useQuery(
    { soloActivos: false },
  );

  const tipoDoc = tiposDocs?.find((d: { codigo: string }) => d.codigo === codigo);

  const { data: estados, isLoading: loadingEstados } = trpc.workflowEstado.estado.list.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  const { data: transiciones, isLoading: loadingTransiciones } = trpc.workflowEstado.transicion.list.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  const { data: roles, isLoading: loadingRoles } = trpc.workflowEstado.role.list.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  const { data: validacion, isLoading: loadingValidacion, refetch: refetchValidacion } = trpc.workflowValidator.validate.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  const isLoading = loadingDoc || loadingEstados || loadingTransiciones || loadingRoles;

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Cargando workflow">
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

  // Vista móvil: siempre solo lectura, React Flow no se monta
  if (isMobile) {
    return (
      <div className="space-y-4" data-testid="mobile-view-container">
        <SkipLinks />
        {/* Encabezado compacto */}
        <div>
          <h1 className="text-xl font-bold">{tipoDoc.nombre}</h1>
          <code className="text-xs text-muted-foreground">{tipoDoc.codigo}</code>
        </div>
        <MobileView
          estados={estados ?? []}
          transiciones={transiciones ?? []}
          tipoDocNombre={tipoDoc.nombre}
        />
        <p className="text-xs text-muted-foreground">
          <Link href="/workflow-designer" className="underline">
            Tipos de documento
          </Link>{" "}
          / {tipoDoc.nombre}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Skip-links WCAG 2.1 AA (US.F2.2.17) */}
      <SkipLinks />

      {/* Banner de solo lectura (US.F2.2.15) */}
      {isReadOnly && <ReadOnlyBanner />}

      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{tipoDoc.nombre}</h1>
            {!tipoDoc.activo && <Badge variant="outline">Inactivo</Badge>}
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

        {/* Botón "Editar workflow" — oculto en modo solo lectura (US.F2.2.15) */}
        {canEdit && (
          <Button asChild>
            <Link
              href={`/workflow-designer/${codigo}/editar`}
              aria-label={`Editar workflow de ${tipoDoc.nombre}`}
            >
              Editar workflow
            </Link>
          </Button>
        )}

        {/* Botón "Auto-layout" deshabilitado en solo lectura */}
        {isReadOnly && (
          <Button
            variant="outline"
            disabled
            aria-label="Auto-layout deshabilitado en modo solo lectura"
            aria-disabled="true"
            data-testid="auto-layout-disabled"
          >
            Auto-layout
          </Button>
        )}
      </div>

      {/* Panel de validación */}
      <ValidationPanel
        issues={validacion?.errors}
        onValidate={() => void refetchValidacion()}
        isLoading={loadingValidacion}
        tipoDocCodigo={codigo}
      />

      {/* Layout: Paleta (read-only oculta) + Canvas + Propiedades */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Paleta lateral — oculta en solo lectura (US.F2.2.15) */}
        {canEdit && (
          <aside
            id="workflow-paleta"
            aria-label="Paleta de elementos del workflow"
            className="w-full lg:w-48"
            tabIndex={-1}
          >
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-sm">Paleta</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Arrastra elementos al canvas para agregar estados.
                </p>
              </CardContent>
            </Card>
          </aside>
        )}

        {/* Grafo de estados y transiciones */}
        <main
          id="workflow-canvas"
          className="flex-1"
          aria-label="Canvas del workflow"
          tabIndex={-1}
        >
          <Card className="h-full">
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
                  Sin estados configurados.{" "}
                  {canEdit && (
                    <Link
                      href={`/workflow-designer/${codigo}/editar`}
                      className="underline"
                    >
                      Editar workflow
                    </Link>
                  )}
                </p>
              ) : (
                <WorkflowGraph
                  estados={estados ?? []}
                  transiciones={transiciones ?? []}
                  tipDocumentoId={tipoDoc?.id ?? ""}
                  tipDocCodigo={codigo}
                />
              )}
            </CardContent>
          </Card>
        </main>

        {/* Panel de propiedades + Matriz de roles */}
        <aside
          id="workflow-propiedades"
          aria-label="Propiedades y matriz de roles"
          className="w-full lg:w-96"
          tabIndex={-1}
        >
          <Card>
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
        </aside>
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
