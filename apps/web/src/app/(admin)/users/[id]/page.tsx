"use client";

/**
 * US-2.3 — Detalle de usuario.
 *
 * Layout:
 *   - Card "Datos básicos" con form inline (fullName + active).
 *   - Card "Roles asignados" con tabla de UserOrganizationRole + dialog
 *     para asignar y botón inline para revocar.
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormField, FormHint } from "@his/ui/components/form";
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
import { RoleAssignmentDialog } from "../role-assignment-dialog";

type RoleMembership = {
  id: string;
  userId: string;
  organizationId: string;
  roleId: string;
  validFrom: Date;
  validTo: Date | null;
  active: boolean;
  role: { id: string; code: string; name: string; organizationId: string | null };
  organization: { id: string; tradeName: string | null; legalName: string };
};

type UserDetail = {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: RoleMembership[];
};

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const utils = trpc.useUtils();

  const [fullName, setFullName] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  // ─── Reset password (ADMIN only) ───────────────────────────────────────────
  const [pwd, setPwd] = React.useState("");
  const [pwdConfirm, setPwdConfirm] = React.useState("");
  const [pwdReason, setPwdReason] = React.useState("");
  const [pwdShow, setPwdShow] = React.useState(false);
  const [pwdError, setPwdError] = React.useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (trpc as any).userAdmin.get.useQuery({ id }, { enabled: !!id });
  const user = query.data as UserDetail | undefined;

  React.useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setActive(user.active);
    }
  }, [user]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateMut = (trpc as any).userAdmin.update.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).userAdmin.get.invalidate({ id });
      setToast({ title: "Datos guardados", variant: "success" });
    },
    onError: (err: { message: string }) =>
      setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revokeMut = (trpc as any).userAdmin.revokeRole.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).userAdmin.get.invalidate({ id });
      setToast({ title: "Rol revocado", variant: "success" });
    },
    onError: (err: { message: string }) =>
      setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resetPwdMut = (trpc as any).userAdmin.resetPassword.useMutation({
    onSuccess: () => {
      setPwd("");
      setPwdConfirm("");
      setPwdReason("");
      setPwdError(null);
      setToast({
        title: "Password actualizado",
        description: "La nueva contraseña ya está vigente. El usuario debe usar el password nuevo en el próximo login.",
        variant: "success",
      });
    },
    onError: (err: { message: string }) => {
      setPwdError(err.message);
      setToast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function submitResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdError(null);
    // Validación cliente: complejidad + match — defensa en profundidad
    // (Zod en el server vuelve a validar — UX más amigable que el error backend).
    if (pwd.length < 12) {
      setPwdError("Mínimo 12 caracteres.");
      return;
    }
    if (!/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) {
      setPwdError("Debe incluir al menos una letra y un dígito.");
      return;
    }
    if (pwd !== pwdConfirm) {
      setPwdError("La confirmación no coincide.");
      return;
    }
    if (pwdReason.trim().length < 5) {
      setPwdError("Razón administrativa requerida (mínimo 5 caracteres).");
      return;
    }
    resetPwdMut.mutate({ id, newPassword: pwd, reason: pwdReason.trim() });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-muted-foreground">
          <Link href="/users" className="hover:underline">
            ← Volver a usuarios
          </Link>
        </div>
        <h1 className="text-2xl font-bold">{user ? user.fullName : "Cargando usuario…"}</h1>
        {user ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <code className="font-mono">{user.email}</code>
            {user.active ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="outline">Inactivo</Badge>
            )}
            {user.mfaEnabled ? (
              <Badge variant="info">MFA</Badge>
            ) : (
              <Badge variant="outline">Sin MFA</Badge>
            )}
          </div>
        ) : null}
      </div>

      {query.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Error: {query.error.message}
        </p>
      ) : null}

      {user ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Datos básicos</CardTitle>
            </CardHeader>
            <CardContent>
              <Form
                onSubmit={(e) => {
                  e.preventDefault();
                  updateMut.mutate({ id: user.id, fullName: fullName.trim(), active });
                }}
              >
                <FormField>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={user.email} disabled />
                  <FormHint>El email no se modifica desde esta pantalla.</FormHint>
                </FormField>
                <FormField>
                  <Label htmlFor="fullName">Nombre completo</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </FormField>
                <FormField>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                    <span>{active ? "Activo" : "Inactivo (login bloqueado)"}</span>
                  </label>
                </FormField>
                <div className="flex justify-end">
                  <Button type="submit" disabled={updateMut.isPending}>
                    {updateMut.isPending ? "Guardando…" : "Guardar cambios"}
                  </Button>
                </div>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Roles asignados</CardTitle>
              <Button onClick={() => setDialogOpen(true)}>Asignar rol</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organización</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead className="w-44">Vigente desde</TableHead>
                    <TableHead className="w-44">Vigente hasta</TableHead>
                    <TableHead className="w-24">Estado</TableHead>
                    <TableHead className="w-32 text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {user.roles.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-sm text-muted-foreground"
                      >
                        Sin roles asignados.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {user.roles.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="font-medium">
                          {m.organization.tradeName ?? m.organization.legalName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m.organization.id}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{m.role.name}</div>
                        <code className="text-xs text-muted-foreground">{m.role.code}</code>
                        {m.role.organizationId === null ? (
                          <Badge variant="info" className="ml-2">
                            Global
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(m.validFrom).toLocaleString("es-SV")}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.validTo ? new Date(m.validTo).toLocaleString("es-SV") : "—"}
                      </TableCell>
                      <TableCell>
                        {m.active ? (
                          <Badge variant="success">Vigente</Badge>
                        ) : (
                          <Badge variant="outline">Cerrado</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              revokeMut.mutate({
                                userId: user.id,
                                organizationId: m.organizationId,
                                roleId: m.roleId,
                              })
                            }
                            disabled={revokeMut.isPending}
                          >
                            Revocar
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cambiar contraseña</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                Restablece la contraseña local del usuario. Requiere rol{" "}
                <Badge variant="info">ADMIN</Badge>. El cambio queda registrado
                en el audit log con la razón administrativa.
              </p>
              <Form onSubmit={submitResetPassword}>
                <FormField>
                  <Label htmlFor="newPassword">Nueva contraseña</Label>
                  <div className="flex gap-2">
                    <Input
                      id="newPassword"
                      type={pwdShow ? "text" : "password"}
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={200}
                      aria-describedby="pwd-hint"
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPwdShow((v) => !v)}
                      aria-pressed={pwdShow}
                      aria-label={pwdShow ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {pwdShow ? "Ocultar" : "Mostrar"}
                    </Button>
                  </div>
                  <p id="pwd-hint" className="text-xs text-muted-foreground">
                    Mínimo 12 caracteres, al menos 1 letra y 1 dígito.
                  </p>
                </FormField>
                <FormField>
                  <Label htmlFor="newPasswordConfirm">Confirmar contraseña</Label>
                  <Input
                    id="newPasswordConfirm"
                    type={pwdShow ? "text" : "password"}
                    value={pwdConfirm}
                    onChange={(e) => setPwdConfirm(e.target.value)}
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={200}
                    className="font-mono"
                  />
                </FormField>
                <FormField>
                  <Label htmlFor="resetReason">Razón administrativa</Label>
                  <Input
                    id="resetReason"
                    value={pwdReason}
                    onChange={(e) => setPwdReason(e.target.value)}
                    placeholder="Ej. usuario solicitó reset por olvido, rotación trimestral, etc."
                    minLength={5}
                    maxLength={500}
                  />
                  <FormHint>Queda registrada en audit log.</FormHint>
                </FormField>
                {pwdError ? (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
                  >
                    {pwdError}
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    No puedes resetear tu propio password aquí.
                  </p>
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={resetPwdMut.isPending || user.id === ""}
                  >
                    {resetPwdMut.isPending ? "Restableciendo…" : "Restablecer contraseña"}
                  </Button>
                </div>
              </Form>
            </CardContent>
          </Card>

          <RoleAssignmentDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            userId={user.id}
            onSuccess={() =>
              setToast({ title: "Rol asignado", variant: "success" })
            }
          />
        </>
      ) : null}

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
