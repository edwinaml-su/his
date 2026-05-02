"use client";

/**
 * US-2.3 — Listado de roles (RBAC).
 *
 * Patrón espejo de catalog-table:
 *   - Filtro búsqueda + toggle activos.
 *   - Acciones: Editar / Permisos / Desactivar.
 *   - Badge de cobertura: ALL / PARTIAL / NONE según porcentaje de
 *     permisos ALLOW vs total del catálogo.
 *
 * El listado mezcla roles globales (organizationId NULL) y de la org actual.
 * Los globales sólo pueden editarse si el usuario es super_admin (server enforced).
 */
import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Badge } from "@his/ui/components/badge";
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
import { RoleForm } from "./role-form";

type RoleRow = {
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  userCount: number;
  allowCount: number;
  permissionCount: number;
  totalPermissions: number;
  coverage: "ALL" | "PARTIAL" | "NONE";
};

export default function RolesPage() {
  const [showInactive, setShowInactive] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<RoleRow | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const utils = trpc.useUtils();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (trpc as any).rbac.listRoles.useQuery({
    activeOnly: !showInactive,
    includeGlobal: true,
    search: search.trim() || undefined,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deactivate = (trpc as any).rbac.deactivateRole.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).rbac.listRoles.invalidate();
      setToast({ title: "Rol desactivado", variant: "success" });
    },
    onError: (err: { message: string }) =>
      setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rows = (query.data ?? []) as RoleRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Roles y permisos</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de roles RBAC (TDR §6.2). Los roles globales (sin
            organización) sólo los administra <code>super_admin</code>.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Nuevo rol
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por código o nombre…"
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
          {query.isLoading ? "Cargando…" : `${rows.length} rol(es)`}
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
              <TableHead className="w-44">Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-24">Alcance</TableHead>
              <TableHead className="w-24 text-right">Usuarios</TableHead>
              <TableHead className="w-32">Cobertura</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <TableHead className="w-56 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !query.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Sin roles.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  {r.description ? (
                    <div className="text-xs text-muted-foreground">{r.description}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  {r.organizationId === null ? (
                    <Badge variant="info">Global</Badge>
                  ) : (
                    <Badge variant="secondary">Org</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{r.userCount}</TableCell>
                <TableCell>
                  <CoverageBadge
                    allow={r.allowCount}
                    total={r.totalPermissions}
                    coverage={r.coverage}
                  />
                </TableCell>
                <TableCell>
                  {r.active ? (
                    <Badge variant="success">Activo</Badge>
                  ) : (
                    <Badge variant="outline">Inactivo</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/roles/${r.id}`}>Permisos</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      Editar
                    </Button>
                    {r.active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deactivate.mutate({ id: r.id })}
                        disabled={deactivate.isPending}
                      >
                        Desactivar
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RoleForm
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSuccess={() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (utils as any).rbac.listRoles.invalidate();
          setToast({
            title: editing ? "Rol actualizado" : "Rol creado",
            variant: "success",
          });
        }}
      />

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

function CoverageBadge({
  allow,
  total,
  coverage,
}: {
  allow: number;
  total: number;
  coverage: "ALL" | "PARTIAL" | "NONE";
}) {
  if (coverage === "ALL") {
    return <Badge variant="success">ALL ({allow}/{total})</Badge>;
  }
  if (coverage === "PARTIAL") {
    return <Badge variant="warning">PARTIAL ({allow}/{total})</Badge>;
  }
  return <Badge variant="outline">NONE (0/{total})</Badge>;
}
