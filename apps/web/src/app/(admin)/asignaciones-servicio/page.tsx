"use client";

/**
 * /admin/asignaciones-servicio — Nivel A.
 *
 * Vista de administración de qué usuarios operan en qué servicios. El sidebar
 * y (Nivel B futuro) las queries data-layer respetan estas asignaciones para
 * que personal de Emergencias no vea pantallas de Quirófano y viceversa.
 *
 * Layout:
 *   1) Selector de usuario (combobox simple con search).
 *   2) Tabla de asignaciones del usuario elegido + botón Asignar.
 *   3) Toggle "incluir asignaciones cerradas" (default: solo vigentes).
 *
 * Roles cross-servicio (ADMIN/DIR/COO/CFO/CEO/MEDICAL_DIRECTOR/AUDITOR)
 * bypassean el filtro — su asignación es informativa.
 */
import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
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
import { ServiceUnitAssignmentDialog } from "./service-unit-assignment-dialog";

type Assignment = {
  id: string;
  userId: string;
  serviceUnitId: string;
  roleId: string | null;
  validFrom: string | Date;
  validTo: string | Date | null;
  active: boolean;
  serviceUnit: { id: string; code: string; name: string };
  role: { id: string; code: string; name: string } | null;
};

type UserListItem = {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
};

export default function AsignacionesServicioPage() {
  const [search, setSearch] = React.useState("");
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [onlyActive, setOnlyActive] = React.useState(true);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const utils = trpc.useUtils();

  // Lista paginada de usuarios. La búsqueda es server-side por email/nombre.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usersQ = (trpc as any).userAdmin.listAll.useQuery({
    page: 1,
    pageSize: 50,
    active: true,
    search: search.trim() || undefined,
  });
  const users = (usersQ.data?.items ?? []) as UserListItem[];

  // Asignaciones del usuario seleccionado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignmentsQ = (trpc as any).userServiceUnit.listByUser.useQuery(
    { userId: selectedUserId ?? "", onlyActive },
    { enabled: !!selectedUserId },
  );
  const assignments = (assignmentsQ.data ?? []) as Assignment[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revokeMut = (trpc as any).userServiceUnit.revoke.useMutation({
    onSuccess: () => {
      if (selectedUserId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (utils as any).userServiceUnit.listByUser.invalidate({
          userId: selectedUserId,
          onlyActive,
        });
      }
      setToast({ title: "Asignación revocada", variant: "success" });
    },
    onError: (err: { message: string }) =>
      setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Asignaciones a servicios</h1>
        <p className="text-sm text-muted-foreground">
          Nivel A — el sidebar y las pantallas operativas se filtran a los
          servicios donde el usuario opera. Roles directivos (ADMIN/DIR/COO/
          CFO/CEO/MEDICAL_DIRECTOR/AUDITOR) bypassean el filtro.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Usuario</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <Label htmlFor="search" className="sr-only">
                Buscar usuario
              </Label>
              <Input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o email…"
              />
            </div>
            <div className="max-h-[60vh] overflow-y-auto rounded-md border">
              {usersQ.isLoading ? (
                <p className="p-2 text-xs text-muted-foreground">Cargando…</p>
              ) : users.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">
                  Sin resultados.
                </p>
              ) : (
                <ul className="divide-y">
                  {users.map((u) => {
                    const selected = u.id === selectedUserId;
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedUserId(u.id)}
                          className={`block w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                            selected ? "bg-muted font-medium" : ""
                          }`}
                          aria-pressed={selected}
                        >
                          <div>{u.fullName}</div>
                          <div className="text-xs text-muted-foreground">
                            {u.email}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>
                {selectedUser
                  ? `Servicios de ${selectedUser.fullName}`
                  : "Asignaciones del usuario"}
              </CardTitle>
              {selectedUser ? (
                <p className="text-xs text-muted-foreground">
                  {selectedUser.email}
                </p>
              ) : null}
            </div>
            {selectedUser ? (
              <Button onClick={() => setDialogOpen(true)}>Asignar servicio</Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {!selectedUser ? (
              <p className="text-sm text-muted-foreground">
                Selecciona un usuario en la columna izquierda para ver y
                gestionar sus servicios.
              </p>
            ) : (
              <>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={onlyActive}
                    onChange={(e) => setOnlyActive(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>Solo asignaciones vigentes</span>
                </label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Servicio</TableHead>
                      <TableHead>Rol asignado</TableHead>
                      <TableHead className="w-40">Vigente desde</TableHead>
                      <TableHead className="w-40">Vigente hasta</TableHead>
                      <TableHead className="w-24">Estado</TableHead>
                      <TableHead className="w-28 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignmentsQ.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          Cargando…
                        </TableCell>
                      </TableRow>
                    ) : assignments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          Sin asignaciones. Usa “Asignar servicio”.
                        </TableCell>
                      </TableRow>
                    ) : (
                      assignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <div className="font-medium">{a.serviceUnit.name}</div>
                            <code className="text-xs text-muted-foreground">
                              {a.serviceUnit.code}
                            </code>
                          </TableCell>
                          <TableCell>
                            {a.role ? (
                              <>
                                <div>{a.role.name}</div>
                                <code className="text-xs text-muted-foreground">
                                  {a.role.code}
                                </code>
                              </>
                            ) : (
                              <Badge variant="outline">Cualquier rol</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(a.validFrom).toLocaleString("es-SV")}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {a.validTo
                              ? new Date(a.validTo).toLocaleString("es-SV")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {a.active ? (
                              <Badge variant="success">Vigente</Badge>
                            ) : (
                              <Badge variant="outline">Cerrado</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {a.active ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => revokeMut.mutate({ id: a.id })}
                                disabled={revokeMut.isPending}
                              >
                                Revocar
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedUserId ? (
        <ServiceUnitAssignmentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          userId={selectedUserId}
          onSuccess={() => setToast({ title: "Servicio asignado", variant: "success" })}
        />
      ) : null}

      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
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
