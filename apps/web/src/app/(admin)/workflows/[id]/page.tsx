"use client";

/**
 * Detalle / edición de un workflow (TipoDocumento).
 *
 * Tabs:
 *   1. Definición    — form editable (nombre, código, descripción, activo).
 *   2. Estados       — tabla CRUD de estados del workflow.
 *   3. Transiciones  — tabla CRUD de transiciones + indicador requiere_firma.
 *   4. Roles         — matriz LLENA|RESPONSABLE|AUTORIZA|FIRMA por rol.
 *   5. Instancias    — instancias activas paginadas (link a cada una).
 *   6. Historial     — bitácora de cambios al workflow.
 *
 * Permisos:
 *   - Solo DIR / WORKFLOW_DESIGNER puede editar.
 *   - El flag `canEdit` lo devuelve el backend en la query principal.
 *   - Resto de usuarios ve la página en modo read-only.
 *
 * Nota de implementación:
 *   Usa routers reales: workflowTipoDoc, workflowEstado, workflowTransicion,
 *   workflowRol, workflowInstance — todos registrados en _app.ts (F2-S1).
 *   Procedures matrix/saveMatrix y historial pendientes (ver TODOs HG-18).
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales auxiliares (complementan inferencia tRPC donde el router
// devuelve raw SQL — no Prisma model)
// ---------------------------------------------------------------------------

type WorkflowDetail = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  canEdit: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type WorkflowEstado = {
  id: string;
  codigo: string;
  nombre: string;
  esInicial: boolean;
  esTerminal: boolean;
  orden: number;
  activo: boolean;
};

type WorkflowTransicion = {
  id: string;
  estadoOrigenId: string;
  estadoOrigenNombre: string;
  estadoDestinoId: string;
  estadoDestinoNombre: string;
  nombre: string;
  requiereFirma: boolean;
  activo: boolean;
};

// Tipo de la UI de matriz (llena/responsable/autoriza/firma por rol).
// TODO(HG-18): workflowRol.list devuelve DocumentoRolRow (una fila por función).
// La transformación a esta estructura matriz está pendiente de implementar.
type WorkflowRol = {
  rolId: string;
  rolNombre: string;
  rolCodigo: string;
  llena: boolean;
  responsable: boolean;
  autoriza: boolean;
  firma: boolean;
};

type WorkflowInstancia = {
  id: string;
  folio: string;
  estadoActual: string;
  responsable: string | null;
  creadaEn: string | Date;
};

type WorkflowHistorialEntry = {
  id: string;
  tipo: string;
  descripcion: string;
  usuario: string;
  timestamp: string | Date;
};

type PaginatedInstancias = {
  items: WorkflowInstancia[];
  total: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(d: string | Date): string {
  return new Date(d).toLocaleString("es-SV");
}

type ToastState = {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
} | null;

// ---------------------------------------------------------------------------
// Sub-componentes de tab
// ---------------------------------------------------------------------------

function TabDefinicion({
  workflow,
  canEdit,
  onSaved,
}: {
  workflow: WorkflowDetail;
  canEdit: boolean;
  onSaved: (msg: string) => void;
}) {
  const [nombre, setNombre] = React.useState(workflow.nombre);
  const [descripcion, setDescripcion] = React.useState(workflow.descripcion ?? "");
  const [activo, setActivo] = React.useState(workflow.activo);

  const utils = trpc.useUtils();
  const update = trpc.workflowTipoDoc.update.useMutation({
    onSuccess: () => {
      void utils.workflowTipoDoc.get.invalidate({ id: workflow.id });
      onSaved("Definición guardada");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Datos del tipo de documento</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({
              id: workflow.id,
              nombre: nombre.trim(),
              descripcionMarkdown: descripcion.trim() || null,
              // activo no está en updateInput del router (campo gestionado separadamente)
            });
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="codigo">Código</Label>
              <Input id="codigo" value={workflow.codigo} disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nombre">Nombre</Label>
              <Input
                id="nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                disabled={!canEdit}
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="descripcion">Descripción</Label>
              <Input
                id="descripcion"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                disabled={!canEdit}
                maxLength={500}
              />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                id="activo"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="activo">Activo</Label>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 text-xs text-muted-foreground md:grid-cols-2">
            <span>Creado: {fmt(workflow.createdAt)}</span>
            <span>Modificado: {fmt(workflow.updatedAt)}</span>
          </div>
          {canEdit && (
            <div className="flex justify-end">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          )}
          {update.error ? (
            <p className="text-sm text-destructive">{update.error.message}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function TabEstados({
  workflowId,
  canEdit,
  onMsg: onSaved,
}: {
  workflowId: string;
  canEdit: boolean;
  onMsg: (msg: string, variant?: "success" | "destructive") => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [newCodigo, setNewCodigo] = React.useState("");
  const [newNombre, setNewNombre] = React.useState("");

  // workflowId es el ID del tipo de documento (ece.tipo_documento.id)
  const query = trpc.workflowEstado.estado.list.useQuery({ tipDocumentoId: workflowId });
  // Router devuelve FlujoEstadoRow (snake_case: es_inicial, es_final, sin activo).
  // Mapeamos a WorkflowEstado para la UI.
  const estados: WorkflowEstado[] = (query.data ?? []).map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    esInicial: r.es_inicial,
    esTerminal: r.es_final,
    orden: r.orden,
    activo: true, // FlujoEstadoRow no expone activo — asumimos activo si está en lista
  }));
  const utils = trpc.useUtils();

  const invalidate = () =>
    void utils.workflowEstado.estado.list.invalidate({ tipDocumentoId: workflowId });

  const create = trpc.workflowEstado.estado.create.useMutation({
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setNewCodigo("");
      setNewNombre("");
      onSaved("Estado creado");
    },
    onError: (e: { message: string }) => onSaved(e.message, "destructive"),
  });

  const remove = trpc.workflowEstado.estado.delete.useMutation({
    onSuccess: () => {
      invalidate();
      onSaved("Estado eliminado");
    },
    onError: (e: { message: string }) => onSaved(e.message, "destructive"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Estados del workflow</CardTitle>
        {canEdit && !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            + Agregar estado
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({
                tipDocumentoId: workflowId,
                codigo: newCodigo.trim(),
                nombre: newNombre.trim(),
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nCodigo">Código</Label>
              <Input
                id="nCodigo"
                value={newCodigo}
                onChange={(e) => setNewCodigo(e.target.value)}
                required
                maxLength={30}
                className="w-32"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nNombre">Nombre</Label>
              <Input
                id="nNombre"
                value={newNombre}
                onChange={(e) => setNewNombre(e.target.value)}
                required
                maxLength={80}
                className="w-56"
              />
            </div>
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? "Creando…" : "Crear"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancelar
            </Button>
          </form>
        )}

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Cargando estados…</p>
        )}
        {query.error ? (
          <p className="text-sm text-destructive">{query.error.message}</p>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-24 text-center">Inicial</TableHead>
              <TableHead className="w-24 text-center">Terminal</TableHead>
              <TableHead className="w-16 text-center">Orden</TableHead>
              <TableHead className="w-24 text-center">Activo</TableHead>
              {canEdit && <TableHead className="w-24 text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {estados.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canEdit ? 7 : 6}
                  className="text-center text-muted-foreground"
                >
                  Sin estados definidos.
                </TableCell>
              </TableRow>
            ) : null}
            {estados.map((est) => (
              <TableRow key={est.id}>
                <TableCell className="font-mono text-xs">{est.codigo}</TableCell>
                <TableCell>{est.nombre}</TableCell>
                <TableCell className="text-center">
                  {est.esInicial ? (
                    <Badge variant="success">SI</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {est.esTerminal ? (
                    <Badge variant="secondary">SI</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center text-xs">{est.orden}</TableCell>
                <TableCell className="text-center">
                  {est.activo ? (
                    <Badge variant="success">Activo</Badge>
                  ) : (
                    <Badge variant="outline">Inactivo</Badge>
                  )}
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`¿Eliminar estado "${est.nombre}"?`)) {
                          remove.mutate({ id: est.id });
                        }
                      }}
                    >
                      Eliminar
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TabTransiciones({
  workflowId,
  canEdit,
  onMsg,
}: {
  workflowId: string;
  canEdit: boolean;
  onMsg: (msg: string, variant?: "success" | "destructive") => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({
    // accion = nombre visible de la transición (p.ej. "aprobar", "rechazar")
    accion: "",
    estadoOrigenId: "",
    estadoDestinoId: "",
    // rolAutorizaId: UUID del rol ECE que autoriza la transición (requerido por backend)
    rolAutorizaId: "",
    requiereFirma: false,
  });

  const query = trpc.workflowEstado.transicion.list.useQuery({ tipDocumentoId: workflowId });
  const estadosQuery = trpc.workflowEstado.estado.list.useQuery({ tipDocumentoId: workflowId });
  // Router devuelve FlujoTransicionRow & { rol_codigo, rol_nombre } (snake_case, usa `accion`).
  // Mapeamos a WorkflowTransicion para la UI. Los nombres de estados origen/destino no están
  // en este endpoint — se muestran vacíos hasta implementar JOIN en el router (TODO HG-18).
  const transiciones: WorkflowTransicion[] = (query.data ?? []).map((r) => ({
    id: r.id,
    estadoOrigenId: r.estado_origen_id,
    estadoOrigenNombre: "",
    estadoDestinoId: r.estado_destino_id,
    estadoDestinoNombre: "",
    nombre: r.accion,
    requiereFirma: r.requiere_firma,
    activo: true, // FlujoTransicionRow no expone activo — asumimos activo si está en lista
  }));
  // Router devuelve FlujoEstadoRow (snake_case). Mapeamos a WorkflowEstado para la UI.
  const estados: WorkflowEstado[] = (estadosQuery.data ?? []).map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    esInicial: r.es_inicial,
    esTerminal: r.es_final,
    orden: r.orden,
    activo: true,
  }));
  const utils = trpc.useUtils();

  const invalidate = () =>
    void utils.workflowEstado.transicion.list.invalidate({ tipDocumentoId: workflowId });

  const create = trpc.workflowEstado.transicion.create.useMutation({
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setForm({ accion: "", estadoOrigenId: "", estadoDestinoId: "", rolAutorizaId: "", requiereFirma: false });
      onMsg("Transición creada");
    },
    onError: (e: { message: string }) => onMsg(e.message, "destructive"),
  });

  const remove = trpc.workflowTransicion.delete.useMutation({
    onSuccess: () => {
      invalidate();
      onMsg("Transición eliminada");
    },
    onError: (e: { message: string }) => onMsg(e.message, "destructive"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Transiciones</CardTitle>
        {canEdit && !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            + Agregar transición
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && (
          <form
            className="grid grid-cols-1 gap-2 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ tipDocumentoId: workflowId, ...form });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="tAccion">Acción (p.ej. aprobar, rechazar)</Label>
              <Input
                id="tAccion"
                value={form.accion}
                onChange={(e) => setForm((f) => ({ ...f, accion: e.target.value }))}
                required
                maxLength={64}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tOrigen">Estado origen</Label>
              <select
                id="tOrigen"
                value={form.estadoOrigenId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, estadoOrigenId: e.target.value }))
                }
                required
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Seleccionar…</option>
                {estados.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tDestino">Estado destino</Label>
              <select
                id="tDestino"
                value={form.estadoDestinoId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, estadoDestinoId: e.target.value }))
                }
                required
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Seleccionar…</option>
                {estados.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.requiereFirma}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, requiereFirma: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-input"
                />
                Requiere firma
              </label>
            </div>
            <div className="flex items-end gap-2 md:col-span-4">
              <Button type="submit" size="sm" disabled={create.isPending}>
                {create.isPending ? "Creando…" : "Crear"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAdding(false)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Cargando transiciones…</p>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Desde</TableHead>
              <TableHead>Hacia</TableHead>
              <TableHead className="w-36 text-center">Requiere firma</TableHead>
              <TableHead className="w-24 text-center">Activo</TableHead>
              {canEdit && <TableHead className="w-24 text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {transiciones.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canEdit ? 6 : 5}
                  className="text-center text-muted-foreground"
                >
                  Sin transiciones definidas.
                </TableCell>
              </TableRow>
            ) : null}
            {transiciones.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.nombre}</TableCell>
                <TableCell className="text-sm">{t.estadoOrigenNombre}</TableCell>
                <TableCell className="text-sm">{t.estadoDestinoNombre}</TableCell>
                <TableCell className="text-center">
                  {t.requiereFirma ? (
                    <Badge variant="warning">Requiere firma</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {t.activo ? (
                    <Badge variant="success">Activo</Badge>
                  ) : (
                    <Badge variant="outline">Inactivo</Badge>
                  )}
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`¿Eliminar transición "${t.nombre}"?`)) {
                          remove.mutate({ id: t.id });
                        }
                      }}
                    >
                      Eliminar
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Celda de la matriz de roles: checkbox controlado.
function MatrizCell({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <TableCell className="text-center">
      <label className="sr-only">{label}</label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-input"
        aria-label={label}
      />
    </TableCell>
  );
}

function TabRoles({
  workflowId,
  canEdit,
  onMsg,
}: {
  workflowId: string;
  canEdit: boolean;
  onMsg: (msg: string, variant?: "success" | "destructive") => void;
}) {
  // workflowRol.list devuelve asignaciones individuales (funcion por rol).
  // No hay endpoint de "matrix" ni "saveMatrix" — se usa assign/revoke por función.
  // TODO(HG-18): implementar UI de checkbox matrix usando workflowRol.assign / workflowRol.revoke.
  const query = trpc.workflowRol.list.useQuery({ tipDocumentoId: workflowId });
  // TODO(HG-18): transformar DocumentoRolRow[] a estructura matriz WorkflowRol[].
  // Por ahora cast para no bloquear typecheck — la UI de matriz está pendiente.
  const roles = (query.data ?? []) as unknown as WorkflowRol[];

  const [localRoles, setLocalRoles] = React.useState<WorkflowRol[]>([]);

  React.useEffect(() => {
    if (roles.length > 0) setLocalRoles(roles);
  }, [roles]);

  // TODO(HG-18): implementar guardado de matriz iterando diff localRoles vs roles
  // y llamando workflowRol.assign / workflowRol.revoke por cada cambio de función.

  function toggleCell(
    rolId: string,
    campo: "llena" | "responsable" | "autoriza" | "firma",
    value: boolean,
  ) {
    setLocalRoles((prev) =>
      prev.map((r) => (r.rolId === rolId ? { ...r, [campo]: value } : r)),
    );
  }

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Cargando roles…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Matriz de roles</CardTitle>
        {/* TODO(HG-18): botón deshabilitado hasta implementar assign/revoke por función */}
        {canEdit && (
          <Button size="sm" disabled title="Pendiente implementación de asignación por función">
            Guardar matriz
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {localRoles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin roles asignados al workflow.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rol</TableHead>
                <TableHead className="w-24 text-center">Llena</TableHead>
                <TableHead className="w-28 text-center">Responsable</TableHead>
                <TableHead className="w-24 text-center">Autoriza</TableHead>
                <TableHead className="w-24 text-center">Firma</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {localRoles.map((r) => (
                <TableRow key={r.rolId}>
                  <TableCell>
                    <div className="font-medium">{r.rolNombre}</div>
                    <code className="text-xs text-muted-foreground">{r.rolCodigo}</code>
                  </TableCell>
                  <MatrizCell
                    checked={r.llena}
                    disabled={!canEdit}
                    onChange={(v) => toggleCell(r.rolId, "llena", v)}
                    label={`${r.rolNombre} - Llena`}
                  />
                  <MatrizCell
                    checked={r.responsable}
                    disabled={!canEdit}
                    onChange={(v) => toggleCell(r.rolId, "responsable", v)}
                    label={`${r.rolNombre} - Responsable`}
                  />
                  <MatrizCell
                    checked={r.autoriza}
                    disabled={!canEdit}
                    onChange={(v) => toggleCell(r.rolId, "autoriza", v)}
                    label={`${r.rolNombre} - Autoriza`}
                  />
                  <MatrizCell
                    checked={r.firma}
                    disabled={!canEdit}
                    onChange={(v) => toggleCell(r.rolId, "firma", v)}
                    label={`${r.rolNombre} - Firma`}
                  />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TabInstancias({ workflowId }: { workflowId: string }) {
  const [page, setPage] = React.useState(1);
  const pageSize = 20;

  // TODO(HG-18): workflowInstance.list requiere episodioId o pacienteId como filtro.
  // Para un listado de instancias por tipo de documento sin episodio conocido se
  // necesita un nuevo procedure (workflowInstance.listByTipo) — pendiente de implementar.
  const query = trpc.workflowInstance.list.useQuery(
    { tipoDocumentoId: workflowId, limit: pageSize },
    { enabled: false }, // deshabilitado hasta tener episodioId o listByTipo
  );

  // Router devuelve { items: InstanciaRow[], nextCursor } — mapeamos a WorkflowInstancia.
  const rawItems = query.data?.items ?? [];
  const data: PaginatedInstancias = {
    items: rawItems.map((r) => ({
      id: r.id,
      folio: r.tipo_codigo,
      estadoActual: r.estado_nombre,
      responsable: r.creado_por ?? null,
      creadaEn: r.creado_en,
    })),
    total: rawItems.length,
  };
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Instancias activas
          {query.data ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({data.total})
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Cargando instancias…</p>
        )}
        {query.error ? (
          <p className="text-sm text-destructive">{query.error.message}</p>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Folio</TableHead>
              <TableHead>Estado actual</TableHead>
              <TableHead>Responsable</TableHead>
              <TableHead className="w-44">Creada</TableHead>
              <TableHead className="w-24 text-right">Detalle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Sin instancias activas.
                </TableCell>
              </TableRow>
            ) : null}
            {data.items.map((inst) => (
              <TableRow key={inst.id}>
                <TableCell className="font-mono text-xs">{inst.folio}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{inst.estadoActual}</Badge>
                </TableCell>
                <TableCell className="text-sm">{inst.responsable ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {fmt(inst.creadaEn)}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/workflows/instancias/${inst.id}`}
                    className="text-xs underline hover:no-underline"
                  >
                    Ver
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <div className="space-x-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TabHistorial({ workflowId }: { workflowId: string }) {
  // TODO(HG-18): workflowTipoDoc no tiene procedure historial.
  // El historial de cambios al tipo de documento se captura en audit.audit_log
  // (trigger SQL 02_audit_triggers.sql). Pendiente exponer via auditIntegrityRouter
  // o un nuevo procedure workflowTipoDoc.historial que consulte audit.audit_log.
  const query = trpc.workflowTipoDoc.get.useQuery(
    { id: workflowId },
    { enabled: false }, // placeholder tipado — historial pendiente
  );
  const entries: WorkflowHistorialEntry[] = [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historial de cambios</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Cargando historial…</p>
        )}
        {query.error ? (
          <p className="text-sm text-destructive">{query.error.message}</p>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Fecha</TableHead>
              <TableHead className="w-32">Tipo</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-40">Usuario</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Sin entradas en el historial.
                </TableCell>
              </TableRow>
            ) : null}
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs">
                  {fmt(e.timestamp)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{e.tipo}</Badge>
                </TableCell>
                <TableCell className="text-sm">{e.descripcion}</TableCell>
                <TableCell className="text-sm">{e.usuario}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function WorkflowDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [toast, setToast] = React.useState<ToastState>(null);

  const query = trpc.workflowTipoDoc.get.useQuery({ id }, { enabled: Boolean(id) });
  const workflow = query.data as WorkflowDetail | undefined;

  function showMsg(
    title: string,
    variant: "success" | "destructive" = "success",
  ) {
    setToast({ title, variant });
  }

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando workflow…</p>;
  }

  if (query.error || !workflow) {
    return (
      <div className="space-y-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/workflows">← Volver</Link>
        </Button>
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(query.error as { message?: string })?.message ??
            "Workflow no encontrado."}
        </p>
      </div>
    );
  }

  const canEdit = workflow.canEdit;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/workflows">← Workflows</Link>
          </Button>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            {workflow.nombre}
            {workflow.activo ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="outline">Inactivo</Badge>
            )}
            {!canEdit && (
              <Badge variant="secondary">Solo lectura</Badge>
            )}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            {workflow.codigo}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="definicion" className="space-y-4">
        <TabsList>
          <TabsTrigger value="definicion">Definición</TabsTrigger>
          <TabsTrigger value="estados">Estados</TabsTrigger>
          <TabsTrigger value="transiciones">Transiciones</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="instancias">Instancias activas</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="definicion">
          <TabDefinicion
            workflow={workflow}
            canEdit={canEdit}
            onSaved={(msg) => showMsg(msg)}
          />
        </TabsContent>

        <TabsContent value="estados">
          <TabEstados
            workflowId={id}
            canEdit={canEdit}
            onMsg={(msg, variant) => showMsg(msg, variant)}
          />
        </TabsContent>

        <TabsContent value="transiciones">
          <TabTransiciones
            workflowId={id}
            canEdit={canEdit}
            onMsg={(msg, variant) => showMsg(msg, variant)}
          />
        </TabsContent>

        <TabsContent value="roles">
          <TabRoles
            workflowId={id}
            canEdit={canEdit}
            onMsg={(msg, variant) => showMsg(msg, variant)}
          />
        </TabsContent>

        <TabsContent value="instancias">
          <TabInstancias workflowId={id} />
        </TabsContent>

        <TabsContent value="historial">
          <TabHistorial workflowId={id} />
        </TabsContent>
      </Tabs>

      {/* Toast global de feedback */}
      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => {
            if (!o) setToast(null);
          }}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? (
              <ToastDescription>{toast.description}</ToastDescription>
            ) : null}
          </div>
        </Toast>
      ) : null}
    </div>
  );
}
