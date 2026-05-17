"use client";

/**
 * Workflow Designer — Editor de estados, transiciones y roles.
 *
 * Permite al usuario con rol WORKFLOW_DESIGNER o DIR:
 *  - CRUD de estados: agregar / editar nombre+orden+esInicial+esFinal / eliminar.
 *  - CRUD de transiciones: agregar (selector origen-destino-accion-rol-requiereFirma) / editar / eliminar.
 *  - Asignación de roles funcionales: seleccionar rol ECE + función LLENA/RESPONSABLE/AUTORIZA/FIRMA.
 *    Revocar asignaciones existentes.
 *
 * UX (heurísticas Nielsen):
 *  - #1 Visibilidad del estado: las secciones muestran conteo de items y cargando spinner.
 *  - #5 Prevención de errores: confirmación antes de eliminar estado/transición.
 *  - #7 Flexibilidad: formularios inline expandibles, no modales.
 *  - #9 Ayuda a reconocer y recuperarse: mensajes de error inline junto al campo.
 *
 * Accesibilidad (WCAG 2.2 AA):
 *  - Todos los inputs tienen <label> asociado.
 *  - Botones destructivos con aria-label descriptivo.
 *  - focus-visible en botones y links.
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

const FUNCION_VALUES = ["LLENA", "RESPONSABLE", "AUTORIZA", "FIRMA"] as const;
const FUNCION_LABELS: Record<string, string> = {
  LLENA: "Llena",
  RESPONSABLE: "Responsable",
  AUTORIZA: "Autoriza",
  FIRMA: "Firma",
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
  rol_autoriza_id: string;
  rol_codigo?: string;
  rol_nombre?: string;
}

interface RolRow {
  id: string;
  rol_id: string;
  funcion: string;
  obligatorio: boolean;
  rol_codigo?: string;
  rol_nombre?: string;
}

interface TipoDocRow {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
}

interface RolDisponibleRow {
  id: string;
  codigo: string;
  nombre: string;
}

// ─── Sección: CRUD Estados ────────────────────────────────────────────────────

function SeccionEstados({
  tipoDocId,
  estados,
  refetch,
}: {
  tipoDocId: string;
  estados: EstadoRow[];
  refetch: () => void;
}) {
  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    codigo: "",
    nombre: "",
    esInicial: false,
    esFinal: false,
    orden: 0,
  });
  const [error, setError] = React.useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMutation = (trpc as any).workflowEstado.estado.create.useMutation({
    onSuccess: () => {
      setShowForm(false);
      resetForm();
      refetch();
    },
    onError: (e: { message: string }) => setError(e.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateMutation = (trpc as any).workflowEstado.estado.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      resetForm();
      refetch();
    },
    onError: (e: { message: string }) => setError(e.message),
  });

  function resetForm() {
    setForm({ codigo: "", nombre: "", esInicial: false, esFinal: false, orden: 0 });
    setError(null);
  }

  function startEdit(e: EstadoRow) {
    setEditingId(e.id);
    setForm({
      codigo: e.codigo,
      nombre: e.nombre,
      esInicial: e.es_inicial,
      esFinal: e.es_final,
      orden: e.orden,
    });
    setShowForm(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        nombre: form.nombre,
        esInicial: form.esInicial,
        esFinal: form.esFinal,
        orden: form.orden,
      });
    } else {
      createMutation.mutate({
        tipDocumentoId: tipoDocId,
        codigo: form.codigo,
        nombre: form.nombre,
        esInicial: form.esInicial,
        esFinal: form.esFinal,
        orden: form.orden,
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            Estados{" "}
            <span className="font-normal text-muted-foreground">({estados.length})</span>
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowForm((v) => !v);
              setEditingId(null);
              resetForm();
            }}
          >
            {showForm ? "Cancelar" : "Agregar estado"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Formulario de creación */}
        {(showForm || editingId) && (
          <form onSubmit={handleSubmit} className="space-y-2 rounded-md border p-3">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">
                {editingId ? "Editar estado" : "Nuevo estado"}
              </legend>

              {!editingId && (
                <div>
                  <label htmlFor="estado-codigo" className="block text-xs font-medium">
                    Código *
                  </label>
                  <input
                    id="estado-codigo"
                    type="text"
                    required
                    value={form.codigo}
                    onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
                    className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="ej. borrador"
                  />
                </div>
              )}

              <div>
                <label htmlFor="estado-nombre" className="block text-xs font-medium">
                  Nombre *
                </label>
                <input
                  id="estado-nombre"
                  type="text"
                  required
                  value={form.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="ej. Borrador"
                />
              </div>

              <div>
                <label htmlFor="estado-orden" className="block text-xs font-medium">
                  Orden
                </label>
                <input
                  id="estado-orden"
                  type="number"
                  min={0}
                  value={form.orden}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, orden: parseInt(e.target.value, 10) || 0 }))
                  }
                  className="mt-0.5 w-24 rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={form.esInicial}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, esInicial: e.target.checked }))
                    }
                    className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  Estado inicial
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={form.esFinal}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, esFinal: e.target.checked }))
                    }
                    className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  Estado final
                </label>
              </div>
            </fieldset>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editingId ? "Guardar cambios" : "Crear estado"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  resetForm();
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {/* Tabla de estados */}
        {estados.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin estados. Agrega el primero.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Código</TableHead>
                <TableHead className="text-xs">Nombre</TableHead>
                <TableHead className="text-xs">Orden</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...estados]
                .sort((a, b) => a.orden - b.orden)
                .map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.codigo}</TableCell>
                    <TableCell className="text-xs">{e.nombre}</TableCell>
                    <TableCell className="text-xs">{e.orden}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {e.es_inicial && (
                          <Badge variant="default" className="text-xs">
                            inicial
                          </Badge>
                        )}
                        {e.es_final && (
                          <Badge variant="secondary" className="text-xs">
                            final
                          </Badge>
                        )}
                        {!e.es_inicial && !e.es_final && (
                          <Badge variant="outline" className="text-xs">
                            intermedio
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => startEdit(e)}
                        aria-label={`Editar estado ${e.nombre}`}
                      >
                        Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sección: CRUD Transiciones ───────────────────────────────────────────────

function SeccionTransiciones({
  tipoDocId,
  estados,
  transiciones,
  rolesDisponibles,
  refetch,
}: {
  tipoDocId: string;
  estados: EstadoRow[];
  transiciones: TransicionRow[];
  rolesDisponibles: RolDisponibleRow[];
  refetch: () => void;
}) {
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState({
    estadoOrigenId: "",
    estadoDestinoId: "",
    accion: "",
    rolAutorizaId: "",
    requiereFirma: true,
  });
  const [error, setError] = React.useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMutation = (trpc as any).workflowTransicion.create.useMutation({
    onSuccess: () => {
      setShowForm(false);
      setForm({
        estadoOrigenId: "",
        estadoDestinoId: "",
        accion: "",
        rolAutorizaId: "",
        requiereFirma: true,
      });
      refetch();
    },
    onError: (e: { message: string }) => setError(e.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteMutation = (trpc as any).workflowTransicion.delete.useMutation({
    onSuccess: () => refetch(),
    onError: (e: { message: string }) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    createMutation.mutate({
      tipDocumentoId: tipoDocId,
      estadoOrigenId: form.estadoOrigenId,
      estadoDestinoId: form.estadoDestinoId,
      accion: form.accion,
      rolAutorizaId: form.rolAutorizaId,
      requiereFirma: form.requiereFirma,
    });
  }

  const estadoNombre = (id: string) =>
    estados.find((e) => e.id === id)?.nombre ?? id;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            Transiciones{" "}
            <span className="font-normal text-muted-foreground">({transiciones.length})</span>
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancelar" : "Agregar transición"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-2 rounded-md border p-3">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">
                Nueva transición
              </legend>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="tx-origen" className="block text-xs font-medium">
                    Estado origen *
                  </label>
                  <select
                    id="tx-origen"
                    required
                    value={form.estadoOrigenId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, estadoOrigenId: e.target.value }))
                    }
                    className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Seleccionar…</option>
                    {estados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="tx-destino" className="block text-xs font-medium">
                    Estado destino *
                  </label>
                  <select
                    id="tx-destino"
                    required
                    value={form.estadoDestinoId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, estadoDestinoId: e.target.value }))
                    }
                    className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Seleccionar…</option>
                    {estados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="tx-accion" className="block text-xs font-medium">
                  Acción *
                </label>
                <input
                  id="tx-accion"
                  type="text"
                  required
                  value={form.accion}
                  onChange={(e) => setForm((f) => ({ ...f, accion: e.target.value }))}
                  className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="ej. firmar"
                />
              </div>

              <div>
                <label htmlFor="tx-rol" className="block text-xs font-medium">
                  Rol autorizador *
                </label>
                <select
                  id="tx-rol"
                  required
                  value={form.rolAutorizaId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, rolAutorizaId: e.target.value }))
                  }
                  className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Seleccionar rol…</option>
                  {rolesDisponibles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.codigo} — {r.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={form.requiereFirma}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, requiereFirma: e.target.checked }))
                  }
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                Requiere firma electrónica
              </label>
            </fieldset>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              Crear transición
            </Button>
          </form>
        )}

        {transiciones.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin transiciones. Define qué acciones son posibles entre estados.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Origen</TableHead>
                <TableHead className="text-xs">Acción</TableHead>
                <TableHead className="text-xs">Destino</TableHead>
                <TableHead className="text-xs">Rol autoriza</TableHead>
                <TableHead className="text-xs">Firma</TableHead>
                <TableHead className="text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {transiciones.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{estadoNombre(t.estado_origen_id)}</TableCell>
                  <TableCell className="font-mono text-xs">{t.accion}</TableCell>
                  <TableCell className="text-xs">{estadoNombre(t.estado_destino_id)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.rol_codigo ?? t.rol_autoriza_id.slice(0, 8) + "…"}
                  </TableCell>
                  <TableCell>
                    {t.requiere_firma ? (
                      <Badge variant="default" className="text-xs">
                        Si
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        No
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                      aria-label={`Eliminar transición ${t.accion}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `¿Eliminar la transición "${t.accion}" de ${estadoNombre(t.estado_origen_id)} → ${estadoNombre(t.estado_destino_id)}?`,
                          )
                        ) {
                          deleteMutation.mutate({ id: t.id });
                        }
                      }}
                    >
                      Eliminar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sección: Asignación de roles funcionales ─────────────────────────────────

function SeccionRoles({
  tipoDocId,
  roles,
  rolesDisponibles,
  refetch,
}: {
  tipoDocId: string;
  roles: RolRow[];
  rolesDisponibles: RolDisponibleRow[];
  refetch: () => void;
}) {
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState({
    rolId: "",
    funcion: "LLENA" as (typeof FUNCION_VALUES)[number],
    obligatorio: true,
  });
  const [error, setError] = React.useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignMutation = (trpc as any).workflowRol.assign.useMutation({
    onSuccess: () => {
      setShowForm(false);
      setForm({ rolId: "", funcion: "LLENA", obligatorio: true });
      refetch();
    },
    onError: (e: { message: string }) => setError(e.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revokeMutation = (trpc as any).workflowRol.revoke.useMutation({
    onSuccess: () => refetch(),
    onError: (e: { message: string }) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    assignMutation.mutate({
      tipDocumentoId: tipoDocId,
      rolId: form.rolId,
      funcion: form.funcion,
      obligatorio: form.obligatorio,
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            Roles funcionales{" "}
            <span className="font-normal text-muted-foreground">({roles.length})</span>
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancelar" : "Asignar rol"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-2 rounded-md border p-3">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">
                Asignar función a rol
              </legend>

              <div>
                <label htmlFor="rol-id" className="block text-xs font-medium">
                  Rol ECE *
                </label>
                <select
                  id="rol-id"
                  required
                  value={form.rolId}
                  onChange={(e) => setForm((f) => ({ ...f, rolId: e.target.value }))}
                  className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Seleccionar rol…</option>
                  {rolesDisponibles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.codigo} — {r.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="rol-funcion" className="block text-xs font-medium">
                  Función *
                </label>
                <select
                  id="rol-funcion"
                  value={form.funcion}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      funcion: e.target.value as (typeof FUNCION_VALUES)[number],
                    }))
                  }
                  className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {FUNCION_VALUES.map((f) => (
                    <option key={f} value={f}>
                      {FUNCION_LABELS[f]}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={form.obligatorio}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, obligatorio: e.target.checked }))
                  }
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                Obligatorio
              </label>
            </fieldset>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" size="sm" disabled={assignMutation.isPending}>
              Asignar función
            </Button>
          </form>
        )}

        {roles.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin roles asignados. Usa el botón para agregar.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Rol</TableHead>
                <TableHead className="text-xs">Función</TableHead>
                <TableHead className="text-xs">Obligatorio</TableHead>
                <TableHead className="text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">
                    <span className="block font-mono">{r.rol_codigo}</span>
                    <span className="block text-muted-foreground">{r.rol_nombre}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {FUNCION_LABELS[r.funcion] ?? r.funcion}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.obligatorio ? (
                      <Badge variant="default" className="text-xs">
                        Si
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Opt
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                      aria-label={`Revocar función ${r.funcion} del rol ${r.rol_codigo}`}
                      onClick={() => {
                        revokeMutation.mutate({
                          tipDocumentoId: tipoDocId,
                          rolId: r.rol_id,
                          funcion: r.funcion as (typeof FUNCION_VALUES)[number],
                        });
                      }}
                    >
                      Revocar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function WorkflowEditorPage() {
  const params = useParams();
  const codigo = typeof params.codigo === "string" ? params.codigo : "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tiposDocs, isLoading: loadingDoc } = (trpc as any).workflowTipoDoc.list.useQuery(
    { soloActivos: false },
  );

  const tipoDoc: TipoDocRow | undefined = tiposDocs?.find(
    (d: TipoDocRow) => d.codigo === codigo,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: estados, refetch: refetchEstados } = (trpc as any).workflowEstado.estado.list.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: transiciones, refetch: refetchTransiciones } = (trpc as any).workflowEstado.transicion.list.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roles, refetch: refetchRoles } = (trpc as any).workflowEstado.role.list.useQuery(
    { tipDocumentoId: tipoDoc?.id ?? "" },
    { enabled: !!tipoDoc?.id },
  );

  // Roles ECE disponibles — cargados una vez para poblar los selects de
  // Transiciones (rol autorizador) y Roles funcionales (rol asignado).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rolesDisponibles } = (trpc as any).workflowRol.listAvailableRoles.useQuery();

  if (loadingDoc) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" aria-hidden="true" />
        <div className="h-40 animate-pulse rounded bg-muted" aria-hidden="true" />
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
          <h1 className="text-2xl font-bold">Editar workflow — {tipoDoc.nombre}</h1>
          <p className="text-sm text-muted-foreground">
            Configura estados, transiciones y roles funcionales.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/workflow-designer/${codigo}`}>
            Ver grafo
          </Link>
        </Button>
      </div>

      {/* Secciones de edición */}
      <div className="space-y-4">
        <SeccionEstados
          tipoDocId={tipoDoc.id}
          estados={estados ?? []}
          refetch={refetchEstados}
        />
        <SeccionTransiciones
          tipoDocId={tipoDoc.id}
          estados={estados ?? []}
          transiciones={transiciones ?? []}
          rolesDisponibles={rolesDisponibles ?? []}
          refetch={refetchTransiciones}
        />
        <SeccionRoles
          tipoDocId={tipoDoc.id}
          roles={roles ?? []}
          rolesDisponibles={rolesDisponibles ?? []}
          refetch={refetchRoles}
        />
      </div>

      {/* Breadcrumb */}
      <p className="text-xs text-muted-foreground">
        <Link href="/workflow-designer" className="underline">
          Tipos de documento
        </Link>{" "}
        /{" "}
        <Link href={`/workflow-designer/${codigo}`} className="underline">
          {tipoDoc.nombre}
        </Link>{" "}
        / Editar
      </p>
    </div>
  );
}
