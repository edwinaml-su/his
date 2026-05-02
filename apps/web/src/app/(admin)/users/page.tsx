"use client";

/**
 * US-2.3 — Listado de usuarios + acciones administrativas.
 *
 * REEMPLAZA el placeholder previo (Sprint 1 stub).
 *
 * UX:
 *  - Filtros: search (email/nombre), rol (code), estado (active/inactive/all).
 *  - Acciones: Ver detalle, Desactivar/Reactivar (toggle active), Nuevo usuario.
 *  - Paginado server-side (page, pageSize=20).
 *
 * El alta de usuario NO crea Auth user en Supabase aún (ver invitation-flow
 * stub en `user-admin.router.ts`). Sólo persiste el registro local.
 */
import * as React from "react";
import Link from "next/link";
import { Badge } from "@his/ui/components/badge";
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
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import { UserForm } from "./user-form";

type StateFilter = "all" | "active" | "inactive";

interface UserItem {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  activeRoleCount: number;
  totalRoleCount: number;
}

export default function UsersPage() {
  const [search, setSearch] = React.useState("");
  const [stateFilter, setStateFilter] = React.useState<StateFilter>("all");
  const [roleCode, setRoleCode] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserItem | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const utils = trpc.useUtils();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (trpc as any).userAdmin.listAll.useQuery({
    page,
    pageSize: 20,
    search: search.trim() || undefined,
    active:
      stateFilter === "all" ? undefined : stateFilter === "active" ? true : false,
    roleCode: roleCode.trim() || undefined,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update = (trpc as any).userAdmin.update.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).userAdmin.listAll.invalidate();
      setToast({ title: "Usuario actualizado", variant: "success" });
    },
    onError: (err: { message: string }) =>
      setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const items = (query.data?.items ?? []) as UserItem[];
  const total = (query.data?.total ?? 0) as number;
  const pageSize = 20;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de usuarios del sistema (TDR §6.1). El alta NO envía
            invitación aún — magic-link queda para Sprint 2.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Nuevo usuario
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por email o nombre…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-sm"
        />
        <Input
          placeholder="Filtrar por rol (code)…"
          value={roleCode}
          onChange={(e) => {
            setRoleCode(e.target.value);
            setPage(1);
          }}
          className="max-w-[200px]"
        />
        <select
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value as StateFilter);
            setPage(1);
          }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Todos</option>
          <option value="active">Solo activos</option>
          <option value="inactive">Solo inactivos</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {query.isLoading ? "Cargando…" : `${total} usuario(s)`}
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
              <TableHead>Email</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-24 text-right">Roles</TableHead>
              <TableHead className="w-44">Último ingreso</TableHead>
              <TableHead className="w-24">MFA</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <TableHead className="w-56 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !query.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Sin usuarios.
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono text-xs">{u.email}</TableCell>
                <TableCell>{u.fullName}</TableCell>
                <TableCell className="text-right">
                  <span className="font-medium">{u.activeRoleCount}</span>
                  <span className="text-xs text-muted-foreground"> / {u.totalRoleCount}</span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("es-SV") : "—"}
                </TableCell>
                <TableCell>
                  {u.mfaEnabled ? (
                    <Badge variant="success">ON</Badge>
                  ) : (
                    <Badge variant="outline">OFF</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {u.active ? (
                    <Badge variant="success">Activo</Badge>
                  ) : (
                    <Badge variant="outline">Inactivo</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/users/${u.id}`}>Detalle</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(u);
                        setFormOpen(true);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => update.mutate({ id: u.id, active: !u.active })}
                      disabled={update.isPending}
                    >
                      {u.active ? "Desactivar" : "Reactivar"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Página {page} de {lastPage}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1 || query.isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= lastPage || query.isLoading}
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
          >
            Siguiente
          </Button>
        </div>
      </div>

      <UserForm
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSuccess={() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (utils as any).userAdmin.listAll.invalidate();
          setToast({
            title: editing ? "Usuario actualizado" : "Usuario creado",
            description: editing
              ? undefined
              : "Stub Sprint 1: no se envió invitación. Magic-link Sprint 2.",
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
