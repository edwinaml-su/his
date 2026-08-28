"use client";

/**
 * WorkflowGrafoView — Vista de grafo del workflow de un tipo de documento.
 *
 * Mejoras US.F2.2.14-17:
 *  - RBAC: solo WORKFLOW_DESIGNER / DIR / ADMIN pueden editar (US.F2.2.14).
 *  - Read-only mode: banner azul + paleta oculta + botones deshabilitados (US.F2.2.15).
 *  - Mobile: viewport < 768px muestra MobileView (lista de estados) (US.F2.2.16).
 *  - Accesibilidad WCAG 2.1 AA: skip-links, aria-labels, focus visible (US.F2.2.17).
 *
 * Cableo grupo "barato" (docs/qa/inventario-componentes-huerfanos-2026-08-26.md
 * Tier 2, decisión @PO+Edwin): ExportButtons (F2.2.11), EditorToolbar (F2.2.04)
 * y SimulatorDialog (F2.2.08) se montan aquí. `roleCodes` llega como prop desde
 * el Server Component en `page.tsx` — reemplaza el TODO(HG-19) que hardcodeaba
 * roleCodes=[] y dejaba canEdit siempre en false.
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
import { WorkflowGraph, type WorkflowGraphHandle } from "./workflow-graph";
import { MobileView } from "./mobile-view";
import { ReadOnlyBanner } from "./read-only-banner";
import { useWorkflowAccess } from "./use-workflow-access";
import { ExportButtons } from "./export-buttons";
import { EditorToolbar } from "./editor-toolbar";
import { SimulatorDialog } from "./simulator-dialog";
import { DependenciasGrafo } from "../../_components/dependencias-grafo";
import { ValidationPanel } from "../../_components/validation-panel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

// ─── Constantes ───────────────────────────────────────────────────────────────

const FUNCION_LABELS: Record<string, string> = {
  LLENA: "Llena",
  RESPONSABLE: "Responsable",
  AUTORIZA: "Autoriza",
  FIRMA: "Firma",
};

// ─── Tipos raw ────────────────────────────────────────────────────────────────

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

// ─── Vista principal ───────────────────────────────────────────────────────────

interface WorkflowGrafoViewProps {
  /** Roles del tenant activo, resueltos server-side (ver page.tsx). */
  roleCodes: string[];
}

export function WorkflowGrafoView({ roleCodes }: WorkflowGrafoViewProps) {
  const params = useParams();
  const codigo = typeof params.codigo === "string" ? params.codigo : "";
  const isMobile = useIsMobile();

  const { canEdit, isReadOnly } = useWorkflowAccess(roleCodes);

  const graphRef = React.useRef<WorkflowGraphHandle>(null);
  const [simulatorOpen, setSimulatorOpen] = React.useState(false);
  const [highlightEstadoId, setHighlightEstadoId] = React.useState<string | null>(null);

  const { data: tiposDocs, isLoading: loadingDoc } = trpc.workflowTipoDoc.list.useQuery(
    { soloActivos: false },
  );

  const tipoDoc = tiposDocs?.find((d) => d.codigo === codigo);

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

  const {
    data: validacion,
    isLoading: loadingValidacion,
    isFetching: fetchingValidacion,
    refetch: refetchValidacion,
  } = trpc.workflowValidator.validate.useQuery(
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
    <div className="space-y-4" data-testid="workflow-editor-root">
      {/* Skip-links WCAG 2.1 AA (US.F2.2.17) */}
      <SkipLinks />

      {/* Banner de solo lectura (US.F2.2.15) */}
      {isReadOnly && <ReadOnlyBanner />}

      {/* Toolbar (US.F2.2.04) — Encuadrar / Auto-layout / breadcrumb / Editar tabla.
          Único breadcrumb de la página: el de abajo se retiró para no duplicar. */}
      <EditorToolbar
        tipoDocNombre={tipoDoc.nombre}
        tipoDocCodigo={codigo}
        readOnly={isReadOnly}
        onAutoLayout={() => graphRef.current?.triggerAutoLayout()}
        onFitView={() => graphRef.current?.fitView()}
      />

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

        <div className="flex items-center gap-2">
          {/* Exportar diagrama (US.F2.2.11) — client-side, sin gate RBAC. */}
          <ExportButtons
            workflowNombre={tipoDoc.nombre}
            // Sin fuente de estado de publicación en esta página (PublishDialog/
            // VersionDiff no están cableados aún) — fijo a PUBLICADO hasta que
            // exista una consulta real.
            estadoWorkflow="PUBLICADO"
          />

          {/* Simulación paso a paso (US.F2.2.08) — query read-only, backend gatea RBAC. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSimulatorOpen(true)}
            aria-label="Simular workflow paso a paso"
            data-testid="simulator-open-btn"
          >
            Simular
          </Button>

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
        </div>
      </div>

      <SimulatorDialog
        open={simulatorOpen}
        onOpenChange={setSimulatorOpen}
        tipDocumentoId={tipoDoc.id}
        workflowNombre={tipoDoc.nombre}
        onEstadoActivo={setHighlightEstadoId}
      />

      {/* Descripción rica (markdown) + módulo HIS — Fase 3 */}
      {(tipoDoc.descripcion_markdown || tipoDoc.modulo_his_target) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Descripción y contexto operativo</CardTitle>
              {tipoDoc.modulo_his_target && (
                <Link
                  href={tipoDoc.modulo_his_target}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Ir al módulo {tipoDoc.modulo_his_target}
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {tipoDoc.descripcion_markdown ? (
              <article className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {tipoDoc.descripcion_markdown}
                </ReactMarkdown>
              </article>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin descripción rica configurada.{" "}
                {canEdit && (
                  <Link
                    href={`/workflow-designer/${codigo}/editar`}
                    className="underline hover:text-foreground"
                  >
                    Agregar desde el editor
                  </Link>
                )}
                .
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grafo de dependencias — Fase 3 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Dependencias del flujo
            <span className="ml-2 font-normal text-muted-foreground">
              ({(tipoDoc.depende_de ?? []).length} prerrequisito(s))
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DependenciasGrafo
            current={{
              codigo: tipoDoc.codigo,
              nombre: tipoDoc.nombre,
              modalidad: tipoDoc.modalidad,
              depende_de: tipoDoc.depende_de ?? null,
            }}
            all={(tiposDocs ?? []).map((d: {
              codigo: string;
              nombre: string;
              modalidad: string;
              depende_de: string[] | null;
            }) => ({
              codigo: d.codigo,
              nombre: d.nombre,
              modalidad: d.modalidad,
              depende_de: d.depende_de,
            }))}
          />
        </CardContent>
      </Card>

      {/* Panel de validación */}
      <ValidationPanel
        issues={validacion?.errors}
        onValidate={() => void refetchValidacion()}
        // isFetching refleja el refetch del botón (isLoading solo es true en la
        // 1ª carga). Sin esto, clickear "Validar" no mostraba spinner ni
        // feedback → parecía que el botón "no funcionaba".
        isLoading={loadingValidacion || fetchingValidacion}
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
                  ref={graphRef}
                  estados={estados ?? []}
                  transiciones={transiciones ?? []}
                  tipDocumentoId={tipoDoc?.id ?? ""}
                  tipDocCodigo={codigo}
                  readOnly={isReadOnly}
                  highlightEstadoId={highlightEstadoId}
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
    </div>
  );
}
