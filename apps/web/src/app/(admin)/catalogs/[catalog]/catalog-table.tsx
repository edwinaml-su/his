"use client";

/**
 * US-3.2 — Tabla de catálogo con búsqueda + filtro activo/inactivo + acciones.
 *
 * UX:
 *  - Search debounced cliente-side (filtro local sobre el resultado).
 *    Para catálogos grandes (>500) hay TODO de paginación servidor en Sprint 2.
 *  - Toggle "Mostrar inactivos" controla el activeOnly enviado al server.
 *  - Acción "Editar" abre el form en modo edit.
 *  - Acción "Desactivar" / "Reactivar" usa la mutation soft-delete del router.
 *    NO existe botón "Eliminar" — soft delete por diseño (TDR §7).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import type { CatalogConfig } from "./catalog-config";

type Row = Record<string, unknown> & { id: string; active: boolean; name: string };

interface CatalogTableProps {
  config: CatalogConfig;
  onEdit: (row: Row) => void;
}

export function CatalogTable({ config, onEdit }: CatalogTableProps) {
  const [showInactive, setShowInactive] = React.useState(true);
  const [search, setSearch] = React.useState("");

  const utils = trpc.useUtils();
  const query = trpc.catalog.list.useQuery({
    catalog: config.model,
    activeOnly: !showInactive,
    search: search.trim().length > 0 ? search.trim() : undefined,
  });

  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const deactivate = trpc.catalog.deactivate.useMutation({
    onSuccess: () => {
      utils.catalog.list.invalidate();
      setToast({ title: "Registro desactivado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reactivate = trpc.catalog.reactivate.useMutation({
    onSuccess: () => {
      utils.catalog.list.invalidate();
      setToast({ title: "Registro reactivado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rows = (query.data ?? []) as Row[];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={`Buscar por código o nombre…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Mostrar inactivos
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {query.isLoading ? "Cargando…" : `${rows.length} registro(s)`}
        </span>
      </div>

      {query.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Error: {query.error.message}
        </p>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-28">Estado</TableHead>
              <TableHead className="w-48 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !query.isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  Sin registros.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">
                  {String(row[config.codeField] ?? "—")}
                </TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>
                  {row.active ? (
                    <Badge variant="success">Activo</Badge>
                  ) : (
                    <Badge variant="outline">Inactivo</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => onEdit(row)}>
                      Editar
                    </Button>
                    {row.active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          deactivate.mutate({ catalog: config.model, id: row.id })
                        }
                        disabled={deactivate.isPending}
                      >
                        Desactivar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          reactivate.mutate({ catalog: config.model, id: row.id })
                        }
                        disabled={reactivate.isPending}
                      >
                        Reactivar
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </div>
  );
}
