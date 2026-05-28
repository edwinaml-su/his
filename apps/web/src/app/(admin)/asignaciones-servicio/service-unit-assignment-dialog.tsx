"use client";

/**
 * Dialog para asignar un usuario a un ServiceUnit (Nivel A — sidebar/rutas).
 *
 * UX:
 *  - Selector de ServiceUnit (de catálogos, scope a la org del tenant).
 *  - Selector de Rol opcional (si vacío: la asignación aplica con cualquier
 *    rol que el usuario tenga en la org).
 *  - Confirmar → `userServiceUnit.assign` (idempotente).
 *
 * El revoke vive como botón inline en la tabla principal — no requiere dialog.
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

interface ServiceUnitAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  /** Callback de éxito — el padre suele refrescar la lista. */
  onSuccess?: () => void;
}

export function ServiceUnitAssignmentDialog({
  open,
  onOpenChange,
  userId,
  onSuccess,
}: ServiceUnitAssignmentDialogProps) {
  const [serviceUnitId, setServiceUnitId] = React.useState<string>("");
  const [roleId, setRoleId] = React.useState<string>("");
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setServiceUnitId("");
      setRoleId("");
      setServerError(null);
    }
  }, [open]);

  // Catálogo de servicios — `catalog.list({ catalog: 'serviceUnit' })` ya
  // filtra por org del tenant.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svcQ = (trpc as any).catalog.list.useQuery(
    { catalog: "serviceUnit", activeOnly: true },
    { enabled: open },
  );
  // Roles disponibles — globales + de la org actual.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rolesQ = (trpc as any).rbac.listRoles.useQuery(
    { activeOnly: true, includeGlobal: true },
    { enabled: open },
  );

  const utils = trpc.useUtils();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignMut = (trpc as any).userServiceUnit.assign.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).userServiceUnit.listByUser.invalidate({ userId });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const serviceUnits = (svcQ.data ?? []) as {
    id: string;
    code: string;
    name: string;
  }[];
  const roles = (rolesQ.data ?? []) as {
    id: string;
    code: string;
    name: string;
    organizationId: string | null;
  }[];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!serviceUnitId) {
      setServerError("Selecciona un servicio.");
      return;
    }
    assignMut.mutate({
      userId,
      serviceUnitId,
      // roleId vacío en select → null (asignación cross-rol del usuario).
      roleId: roleId || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar a un servicio</DialogTitle>
          <DialogDescription>
            El usuario verá en su menú solo los items vinculados a los servicios
            asignados. Roles cross-servicio (ADMIN/DIR/COO/etc.) ven todo.
          </DialogDescription>
        </DialogHeader>
        <Form onSubmit={handleSubmit}>
          <FormField>
            <Label htmlFor="serviceUnitId">
              Servicio <span className="text-destructive">*</span>
            </Label>
            <select
              id="serviceUnitId"
              value={serviceUnitId}
              onChange={(e) => setServiceUnitId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Selecciona —</option>
              {serviceUnits.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
            <FormHint>
              Solo aparecen servicios activos de la organización actual.
            </FormHint>
          </FormField>

          <FormField>
            <Label htmlFor="roleId">Rol (opcional)</Label>
            <select
              id="roleId"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— Cualquier rol del usuario —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
                  {r.organizationId === null ? " · Global" : ""}
                </option>
              ))}
            </select>
            <FormHint>
              Si especificas un rol, la asignación solo aplica cuando el usuario
              actúa con ese rol. Default: cualquier rol.
            </FormHint>
          </FormField>

          {serverError ? <FormError>{serverError}</FormError> : null}

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
              {assignMut.isPending ? "Asignando…" : "Asignar"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
