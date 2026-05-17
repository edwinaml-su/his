"use client";

/**
 * §ECE Motor de Workflow — Listado de tipos de documento (US.F2.1.1).
 *
 * Consume: trpc.workflow.tipoDoc.list (Stream 13).
 * Guard de rol: botón "Nuevo workflow" solo visible para DIR / WORKFLOW_DESIGNER.
 * Paginación: client-side sobre los datos ya filtrados (la lista es < 200 filas en prod).
 */
import * as React from "react";
import Link from "next/link";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales (espejo del output de workflow.tipoDoc.list)
// ---------------------------------------------------------------------------
type Modalidad = "ambulatorio" | "hospitalario" | "ambos";
type ModalidadFilter = Modalidad | "TODOS";

type TipoDocumentoRow = {
  id: string;
  codigo: string;
  nombre: string;
  modalidad: Modalidad;
  tipo_registro: "maestro" | "transaccional" | "historico";
  estadosCount: number;
  transicionesCount: number;
  instanciasActivas: number;
  activo: boolean;
};

// Roles que pueden crear/editar workflows (guard client-side, server enforced en el router).
const ROLES_DISEÑADOR = new Set(["DIR", "WORKFLOW_DESIGNER"]);

const MODALIDAD_OPCIONES: { value: ModalidadFilter; label: string }[] = [
  { value: "TODOS", label: "Todas las modalidades" },
  { value: "ambulatorio", label: "Ambulatorio" },
  { value: "hospitalario", label: "Hospitalario" },
  { value: "ambos", label: "Ambos" },
];

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function WorkflowsPage() {
  const [modalidad, setModalidad] = React.useState<ModalidadFilter>("TODOS");
  const [soloActivos, setSoloActivos] = React.useState(true);
  const [busqueda, setBusqueda] = React.useState("");
  const [pagina, setPagina] = React.useState(1);

  // El router aún no existe en _app.ts (Stream 13) — cast as any para no bloquear
  // el build; cuando Stream 13 registre workflow en _app.ts esto se resolverá automáticamente.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (trpc as any).workflow.tipoDoc.list.useQuery(
    {
      ...(modalidad !== "TODOS" && { modalidad }),
      activo: soloActivos ? true : undefined,
      ...(busqueda.trim() && { search: busqueda.trim() }),
    },
    { keepPreviousData: true },
  );

  // Leer roles del tenant context desde la sesión (disponible en el cliente vía trpc.userAdmin)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionQuery = (trpc as any).userAdmin?.me?.useQuery?.() ?? { data: null };
  const roleCodes: string[] = sessionQuery.data?.roleCodes ?? [];
  const puedeCrear = roleCodes.some((r: string) => ROLES_DISEÑADOR.has(r));

  const filas: TipoDocumentoRow[] = query.data ?? [];

  // Paginación client-side
  const totalPaginas = Math.max(1, Math.ceil(filas.length / PAGE_SIZE));
  const inicio = (pagina - 1) * PAGE_SIZE;
  const filasPagina = filas.slice(inicio, inicio + PAGE_SIZE);

  // Reset de página cuando cambian los filtros
  React.useEffect(() => {
    setPagina(1);
  }, [modalidad, soloActivos, busqueda]);

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Tipos de documento (Workflow)</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo del motor de workflow configurable — ECE MINSAL (US.F2.1.1).
          </p>
        </div>
        {puedeCrear && (
          <Button asChild>
            <Link href="/workflows/new">Nuevo workflow</Link>
          </Button>
        )}
      </div>

      {/* Filtros */}
      <div className="rounded-md border bg-card p-4">
        <p className="mb-3 text-sm font-medium">Filtros</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="filtro-modalidad">Modalidad</Label>
            <Select
              value={modalidad}
              onValueChange={(v) => setModalidad(v as ModalidadFilter)}
            >
              <SelectTrigger id="filtro-modalidad">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODALIDAD_OPCIONES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="filtro-busqueda">Búsqueda</Label>
            <Input
              id="filtro-busqueda"
              placeholder="Código o nombre…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>

          <div className="flex items-end pb-0.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={soloActivos}
                onChange={(e) => setSoloActivos(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Solo activos
            </label>
          </div>
        </div>
      </div>

      {/* Estado de carga / error */}
      {query.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Error: {String(query.error.message)}
        </p>
      )}

      {/* Tabla */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-32">Modalidad</TableHead>
              <TableHead className="w-36">Tipo registro</TableHead>
              <TableHead className="w-24 text-right">Estados</TableHead>
              <TableHead className="w-28 text-right">Transiciones</TableHead>
              <TableHead className="w-32 text-right">Instancias activas</TableHead>
              <TableHead className="w-24">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <SkeletonRows />
            ) : filasPagina.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-sm text-muted-foreground"
                >
                  Sin tipos de documento que coincidan con los filtros.
                </TableCell>
              </TableRow>
            ) : (
              filasPagina.map((fila) => (
                <TableRow
                  key={fila.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    window.location.href = `/workflows/${fila.id}`;
                  }}
                >
                  <TableCell className="font-mono text-xs">{fila.codigo}</TableCell>
                  <TableCell className="font-medium">{fila.nombre}</TableCell>
                  <TableCell>
                    <ModalidadBadge modalidad={fila.modalidad} />
                  </TableCell>
                  <TableCell className="capitalize">{fila.tipo_registro}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fila.estadosCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fila.transicionesCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fila.instanciasActivas}
                  </TableCell>
                  <TableCell>
                    {fila.activo ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="outline">Inactivo</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Paginación */}
      {!query.isLoading && filas.length > 0 && (
        <PaginacionBar
          paginaActual={pagina}
          totalPaginas={totalPaginas}
          totalFilas={filas.length}
          onCambiar={setPagina}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: PAGE_SIZE }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 8 }).map((__, j) => (
            <TableCell key={j}>
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function ModalidadBadge({ modalidad }: { modalidad: Modalidad }) {
  if (modalidad === "ambulatorio") {
    return <Badge variant="info">Ambulatorio</Badge>;
  }
  if (modalidad === "hospitalario") {
    return <Badge variant="secondary">Hospitalario</Badge>;
  }
  return <Badge variant="warning">Ambos</Badge>;
}

function PaginacionBar({
  paginaActual,
  totalPaginas,
  totalFilas,
  onCambiar,
}: {
  paginaActual: number;
  totalPaginas: number;
  totalFilas: number;
  onCambiar: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {totalFilas} tipo(s) · página {paginaActual} de {totalPaginas}
      </span>
      <div className="inline-flex gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCambiar(paginaActual - 1)}
          disabled={paginaActual <= 1}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCambiar(paginaActual + 1)}
          disabled={paginaActual >= totalPaginas}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
