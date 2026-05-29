"use client";

/**
 * US-2.3 — Diálogo para asignar un rol a un usuario en una organización.
 *
 * UX:
 *  - Selector de organización (de las que el admin actual ve via
 *    `organization.listAll`).
 *  - Selector de rol (carga `rbac.listRoles`, mezcla globales + de la org).
 *  - Confirmar → `userAdmin.assignRole` (idempotente).
 *
 * Para revocar se usa el botón en cada fila del detalle del usuario, que
 * llama directo a `userAdmin.revokeRole`.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import { Form, FormError, FormField, FormHint } from "@his/ui/components/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

interface RoleAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  /** Pre-selecciona organización si viene del contexto (ej. tenant actual). */
  defaultOrgId?: string;
  onSuccess?: () => void;
}

export function RoleAssignmentDialog({
  open,
  onOpenChange,
  userId,
  defaultOrgId,
  onSuccess,
}: RoleAssignmentDialogProps) {
  const [orgId, setOrgId] = React.useState<string>(defaultOrgId ?? "");
  const [roleId, setRoleId] = React.useState<string>("");
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setOrgId(defaultOrgId ?? "");
      setRoleId("");
      setServerError(null);
    }
  }, [open, defaultOrgId]);

  // Lista de orgs visibles para el admin (las que ya tiene asociadas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgsQ = (trpc as any).organization.listAll.useQuery(undefined, { enabled: open });
  // Lista de roles para la ORGANIZACIÓN ELEGIDA (no la del tenant activo del admin).
  // Sin el parámetro `organizationId`, el router usaría ctx.tenant.organizationId
  // del admin → si el admin está en una org distinta a la elegida, vería los
  // roles de SU org en lugar de la org destino → dropdown vacío al filtrar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rolesQ = (trpc as any).rbac.listRoles.useQuery(
    { activeOnly: true, includeGlobal: true, organizationId: orgId || undefined },
    { enabled: open && !!orgId },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utils = trpc.useUtils();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignMut = (trpc as any).userAdmin.assignRole.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).userAdmin.get.invalidate({ id: userId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).userAdmin.listAll.invalidate();
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const orgs = (orgsQ.data ?? []) as { id: string; tradeName: string; legalName: string }[];
  const allRoles = (rolesQ.data ?? []) as {
    id: string;
    code: string;
    name: string;
    organizationId: string | null;
  }[];

  // Mostrar sólo roles válidos para la org elegida: globales + de esa org.
  const availableRoles = allRoles.filter(
    (r) => r.organizationId === null || r.organizationId === orgId,
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!orgId || !roleId) {
      setServerError("Selecciona organización y rol.");
      return;
    }
    assignMut.mutate({ userId, organizationId: orgId, roleId });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar rol</DialogTitle>
          <DialogDescription>
            Otorga un rol al usuario en una organización. Si la asignación
            ya existe vigente, se mantiene (no-op idempotente).
          </DialogDescription>
        </DialogHeader>
        <Form onSubmit={handleSubmit}>
          <FormField>
            <Label htmlFor="orgId">
              Organización <span className="text-destructive">*</span>
            </Label>
            <select
              id="orgId"
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setRoleId(""); // reset al cambiar de org
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Selecciona —</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.tradeName ?? o.legalName}
                </option>
              ))}
            </select>
            <FormHint>
              Sólo aparecen organizaciones donde tienes membresía vigente.
            </FormHint>
          </FormField>

          <FormField>
            <Label htmlFor="roleId">
              Rol <span className="text-destructive">*</span>
            </Label>
            <select
              id="roleId"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={!orgId}
            >
              <option value="">— Selecciona —</option>
              {availableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code}) {r.organizationId === null ? "· Global" : ""}
                </option>
              ))}
            </select>
            <FormHint>
              Los roles globales aparecen disponibles para cualquier organización.
            </FormHint>
          </FormField>

          {serverError ? (
            <FormError>{serverError}</FormError>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={assignMut.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={assignMut.isPending}>
              {assignMut.isPending ? "Asignando…" : "Asignar rol"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
