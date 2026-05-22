"use client";

/**
 * /admin/workflow-overrides — Fase 6 del workflow-designer enhancement.
 *
 * Permite al DIR del establecimiento configurar overrides operativos sobre
 * los tipos de documento NTEC del catálogo central. Cada fila combina:
 *
 *  - El tipo_documento global (codigo, nombre, modalidad, depende_de global)
 *  - El override del establecimiento (si existe) — activo, obligatorio,
 *    depende_de override, nota DIR
 *
 * Cambios persisten vía `workflowTipoDocOverride.upsert/remove`. RLS impide
 * que un DIR vea o edite overrides de otro establecimiento.
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

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TipoDocGlobal {
  id: string;
  codigo: string;
  nombre: string;
  modalidad: string;
  inmutable: boolean;
  depende_de: string[] | null;
  activo: boolean;
}

interface OverrideRow {
  tipo_documento_id: string;
  establecimiento_id: string;
  tipo_codigo: string;
  tipo_nombre: string;
  activo_override: boolean | null;
  obligatorio_override: boolean | null;
  depende_de_override: string[] | null;
  nota_dir: string | null;
}

// ─── Form de upsert ───────────────────────────────────────────────────────────

function OverrideForm({
  tipo,
  override,
  onClose,
  onSaved,
}: {
  tipo: TipoDocGlobal;
  override: OverrideRow | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [activoOverride, setActivoOverride] = React.useState<string>(
    override?.activo_override === null || override?.activo_override === undefined
      ? "global"
      : override.activo_override
      ? "true"
      : "false",
  );
  const [obligatorioOverride, setObligatorioOverride] = React.useState<string>(
    override?.obligatorio_override === null ||
      override?.obligatorio_override === undefined
      ? "global"
      : override.obligatorio_override
      ? "true"
      : "false",
  );
  const [usarDependeOverride, setUsarDependeOverride] = React.useState(
    override?.depende_de_override !== null && override?.depende_de_override !== undefined,
  );
  const [dependeOverrideText, setDependeOverrideText] = React.useState(
    override?.depende_de_override?.join(", ") ?? "",
  );
  const [notaDir, setNotaDir] = React.useState(override?.nota_dir ?? "");
  const [error, setError] = React.useState<string | null>(null);

  const upsertMutation = trpc.workflowTipoDocOverride.upsert.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: { message: string }) => setError(e.message),
  });

  const removeMutation = trpc.workflowTipoDocOverride.remove.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: { message: string }) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const dependeArray = usarDependeOverride
      ? dependeOverrideText
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : null;

    upsertMutation.mutate({
      tipoDocumentoId: tipo.id,
      activoOverride: activoOverride === "global" ? null : activoOverride === "true",
      obligatorioOverride:
        obligatorioOverride === "global" ? null : obligatorioOverride === "true",
      dependeDeOverride: dependeArray,
      notaDir: notaDir.trim().length > 0 ? notaDir.trim() : null,
    });
  }

  function handleRemove() {
    if (!window.confirm(`¿Eliminar el override para ${tipo.codigo}? Volverá a usar la configuración global.`)) return;
    setError(null);
    removeMutation.mutate({ tipoDocumentoId: tipo.id });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">
          Override: <code className="font-mono text-sm">{tipo.codigo}</code> — {tipo.nombre}
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar">
          ✕
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="activo-override" className="block text-xs font-medium">
            Activo en este establecimiento
          </label>
          <select
            id="activo-override"
            value={activoOverride}
            onChange={(e) => setActivoOverride(e.target.value)}
            className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="global">Usar global ({tipo.activo ? "activo" : "inactivo"})</option>
            <option value="true">Forzar activo</option>
            <option value="false">Forzar inactivo</option>
          </select>
        </div>
        <div>
          <label htmlFor="obligatorio-override" className="block text-xs font-medium">
            Obligatoriedad en este establecimiento
          </label>
          <select
            id="obligatorio-override"
            value={obligatorioOverride}
            onChange={(e) => setObligatorioOverride(e.target.value)}
            className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="global">Usar global</option>
            <option value="true">Obligatorio</option>
            <option value="false">Opcional (no aplicar enforcement)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={usarDependeOverride}
            onChange={(e) => setUsarDependeOverride(e.target.checked)}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          Override del grafo de dependencias (depende_de)
        </label>
        {usarDependeOverride && (
          <div className="mt-1">
            <input
              type="text"
              value={dependeOverrideText}
              onChange={(e) => setDependeOverrideText(e.target.value)}
              placeholder={
                tipo.depende_de && tipo.depende_de.length > 0
                  ? `Global: ${tipo.depende_de.join(", ")}`
                  : "Códigos separados por coma (ej. FICHA_ID, HOJA_ING)"
              }
              className="mt-0.5 w-full rounded border px-2 py-1 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Si dejas vacío y guardas, el tipo no tendrá dependencias en este establecimiento.
            </p>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="nota-dir" className="block text-xs font-medium">
          Nota DIR (justificación, máximo 2000 caracteres)
        </label>
        <textarea
          id="nota-dir"
          value={notaDir}
          onChange={(e) => setNotaDir(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Ej: 'Este establecimiento es ambulatorio puro; el documento HOJA_ING no aplica.'"
          className="mt-0.5 w-full rounded border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="mt-0.5 text-xs text-muted-foreground">
          {notaDir.length} / 2000
        </p>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={upsertMutation.isPending}>
          {upsertMutation.isPending ? "Guardando…" : "Guardar override"}
        </Button>
        {override && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={handleRemove}
            disabled={removeMutation.isPending}
          >
            Eliminar override
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function WorkflowOverridesPage() {
  const [tipoSeleccionado, setTipoSeleccionado] = React.useState<TipoDocGlobal | null>(null);

  const tiposQuery = trpc.workflowTipoDoc.list.useQuery({ soloActivos: false });
  const overridesQuery = trpc.workflowTipoDocOverride.list.useQuery();

  if (tiposQuery.isLoading || overridesQuery.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader />
        <div className="h-40 animate-pulse rounded bg-muted" aria-hidden />
      </div>
    );
  }

  if (tiposQuery.error || overridesQuery.error) {
    return (
      <div className="space-y-4">
        <PageHeader />
        <Alert variant="destructive">
          <AlertTitle>Error al cargar</AlertTitle>
          <AlertDescription>
            {(tiposQuery.error || overridesQuery.error)?.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const tipos = tiposQuery.data ?? [];
  const overrides = overridesQuery.data ?? [];

  const overrideMap = new Map<string, OverrideRow>(
    overrides.map((o: OverrideRow) => [o.tipo_documento_id, o]),
  );

  return (
    <div className="space-y-4">
      <PageHeader />

      {tipoSeleccionado && (
        <OverrideForm
          tipo={tipoSeleccionado}
          override={overrideMap.get(tipoSeleccionado.id)}
          onClose={() => setTipoSeleccionado(null)}
          onSaved={() => overridesQuery.refetch()}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Catálogo de tipos de documento
            <span className="ml-2 font-normal text-muted-foreground">
              ({tipos.length} tipos • {overrides.length} con override en este establecimiento)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Código</TableHead>
                <TableHead className="text-xs">Nombre</TableHead>
                <TableHead className="text-xs">Modalidad</TableHead>
                <TableHead className="text-xs">Override</TableHead>
                <TableHead className="text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tipos.map((t: TipoDocGlobal) => {
                const o = overrideMap.get(t.id);
                const tieneOverride =
                  o &&
                  (o.activo_override !== null ||
                    o.obligatorio_override !== null ||
                    o.depende_de_override !== null);

                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.codigo}</TableCell>
                    <TableCell className="text-xs">{t.nombre}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {t.modalidad}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {tieneOverride ? (
                        <div className="flex flex-wrap gap-1">
                          {o!.obligatorio_override === false && (
                            <Badge variant="secondary" className="text-xs">
                              Opcional aquí
                            </Badge>
                          )}
                          {o!.activo_override === false && (
                            <Badge variant="destructive" className="text-xs">
                              Inactivo aquí
                            </Badge>
                          )}
                          {o!.depende_de_override !== null && (
                            <Badge variant="default" className="text-xs">
                              Dep. override ({o!.depende_de_override.length})
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => setTipoSeleccionado(t)}
                      >
                        {tieneOverride ? "Editar" : "Configurar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        <Link href="/workflow-designer" className="underline">
          Workflow designer
        </Link>{" "}
        / Overrides por establecimiento
      </p>
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Overrides de workflow por establecimiento</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Permite a la dirección médica ajustar la obligatoriedad y las dependencias
        de cada documento NTEC al contexto operativo del establecimiento. Requiere
        rol <code>DIR</code>.
      </p>
    </div>
  );
}
