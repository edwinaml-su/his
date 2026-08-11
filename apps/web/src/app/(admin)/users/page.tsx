"use client";

/**
 * US-2.3 — Listado de usuarios + acciones administrativas.
 *
 * CC-0019: el alta de usuario ahora crea la cuenta en Supabase Auth y envía
 * una invitación por email (enlace para fijar contraseña) — ver
 * `packages/trpc/src/routers/user-admin.router.ts`. Esta página muestra el
 * estado de esa cuenta (`authStatus`) por fila y ofrece "Reenviar invitación".
 *
 * UX:
 *  - Filtros: search (email/nombre), rol (code), estado (active/inactive/all).
 *  - Acciones: Ver detalle, Desactivar/Reactivar (toggle active), Nuevo usuario,
 *    Reenviar invitación.
 *  - Paginado server-side (page, pageSize=20).
 *  - Sección "Sin cuenta de acceso" (`listSinCuentaAuth`): usuarios locales
 *    activos sin fila en `auth.users` (huérfanos de un alta previa fallida) —
 *    permite provisionar + invitar en un click (reusa `resendInvitation`).
 */
import * as React from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { EmptyState, ErrorState } from "@his/ui/components/states";
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
type AuthStatus = "SIN_CUENTA" | "INVITADO" | "ACTIVO";

interface UserItem {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  activeRoleCount: number;
  totalRoleCount: number;
  authStatus: AuthStatus;
}

function AuthStatusBadge({ status }: { status: AuthStatus }) {
  if (status === "ACTIVO") return <Badge variant="success">Con acceso</Badge>;
  if (status === "INVITADO") return <Badge variant="info">Invitado</Badge>;
  return <Badge variant="destructive">Sin cuenta</Badge>;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sinCuentaQuery = (trpc as any).userAdmin.listSinCuentaAuth.useQuery();
  const sinCuenta = (sinCuentaQuery.data ?? []) as {
    id: string;
    email: string;
    fullName: string;
  }[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resendMut = (trpc as any).userAdmin.resendInvitation.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).userAdmin.listAll.invalidate();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).userAdmin.listSinCuentaAuth.invalidate();
      setToast({ title: "Invitación enviada", variant: "success" });
    },
    onError: (err: { message: string }) =>
      setToast({
        title: "No se pudo enviar la invitación",
        description: err.message,
        variant: "destructive",
      }),
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
            Gestión de usuarios del sistema (TDR §6.1). El alta crea la cuenta
            de acceso y envía una invitación por email para fijar contraseña.
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
        <ErrorState
          title="No pudimos cargar la información"
          description="Verifica tu conexión e intenta de nuevo."
          retry={() => query.refetch()}
        />
      ) : null}

      {sinCuenta.length > 0 ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm font-medium">
            {sinCuenta.length} usuario(s) sin cuenta de acceso
          </p>
          <p className="mb-2 text-xs text-muted-foreground">
            Quedaron sin cuenta en el proveedor de autenticación (alta previa
            incompleta). Provisiona la cuenta e invita en un click.
          </p>
          <ul className="space-y-1.5">
            {sinCuenta.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{u.fullName}</span>{" "}
                  <code className="text-xs text-muted-foreground">{u.email}</code>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resendMut.mutate({ userId: u.id })}
                  disabled={resendMut.isPending}
                >
                  Crear cuenta e invitar
                </Button>
              </li>
            ))}
          </ul>
        </div>
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
              <TableHead className="w-32">Cuenta acceso</TableHead>
              <TableHead className="w-72 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !query.isLoading && !query.error ? (
              <TableRow>
                <TableCell colSpan={8} className="p-0">
                  <EmptyState
                    icon={Users}
                    title="Sin usuarios"
                    description="Crea el primer usuario para empezar."
                    action={{ label: "Nuevo usuario", onClick: () => { setEditing(null); setFormOpen(true); } }}
                  />
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
                <TableCell>
                  <AuthStatusBadge status={u.authStatus} />
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
                    {u.authStatus !== "ACTIVO" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resendMut.mutate({ userId: u.id })}
                        disabled={resendMut.isPending}
                      >
                        Reenviar invitación
                      </Button>
                    ) : null}
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
        onSuccess={(info) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (utils as any).userAdmin.listAll.invalidate();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (utils as any).userAdmin.listSinCuentaAuth.invalidate();
          setToast({
            title: editing ? "Usuario actualizado" : "Usuario creado",
            description: editing
              ? undefined
              : info?.invitationSent === false
                ? "No se pudo enviar la invitación por email. Usa 'Reenviar invitación' en la lista."
                : "Se envió una invitación por email para que el usuario defina su contraseña.",
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
