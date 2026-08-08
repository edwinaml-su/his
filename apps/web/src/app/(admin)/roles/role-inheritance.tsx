"use client";

/**
 * CC-0017 — selector "hereda de" (rol padre) en el detalle de rol.
 *
 * Un rol que hereda de otro pasa automáticamente los `requireRole([...])`
 * que ya pasaba el rol padre (motor en `packages/trpc/src/rbac/effective-roles.ts`),
 * SIN tocar los 376 call sites existentes. Útil para crear variantes de un
 * rol base (p.ej. "MEDICO_RESIDENTE_JR" heredando de "PHYSICIAN") sin
 * reconfigurar cada permiso desde cero.
 *
 * No permite auto-herencia ni ciclos — el server los rechaza con
 * BAD_REQUEST; el mensaje de error del server se muestra tal cual.
 */
import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

interface RoleOption {
  id: string;
  code: string;
  name: string;
  organizationId: string | null;
}

interface RoleInheritanceProps {
  roleId: string;
  roleCode: string;
  inheritsFromRoleId: string | null;
}

const NONE_VALUE = "__none__";

export function RoleInheritance({
  roleId,
  roleCode,
  inheritsFromRoleId,
}: RoleInheritanceProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rolesQ = (trpc as any).rbac.listRoles.useQuery({});
  const roles = React.useMemo(
    () => ((rolesQ.data ?? []) as RoleOption[]).filter((r) => r.id !== roleId),
    [rolesQ.data, roleId],
  );

  const [selected, setSelected] = React.useState(inheritsFromRoleId ?? NONE_VALUE);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSelected(inheritsFromRoleId ?? NONE_VALUE);
  }, [inheritsFromRoleId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utils = trpc.useUtils();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setMut = (trpc as any).rbac.setRoleInheritance.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).rbac.getRole.invalidate({ id: roleId });
      setServerError(null);
    },
    onError: (err: { message: string }) => {
      setServerError(err.message);
      setSelected(inheritsFromRoleId ?? NONE_VALUE); // revertir el select
    },
  });

  const currentParent = roles.find((r) => r.id === inheritsFromRoleId);

  function handleChange(value: string) {
    setSelected(value);
    setMut.mutate({ roleId, parentRoleId: value === NONE_VALUE ? null : value });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Hereda accesos de</span>
        {currentParent ? (
          <Badge variant="secondary">{currentParent.code}</Badge>
        ) : (
          <Badge variant="outline">Ninguno</Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={handleChange} disabled={setMut.isPending}>
          <SelectTrigger className="max-w-xs">
            <SelectValue placeholder="Sin herencia" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>Sin herencia</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.code} — {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {setMut.isPending ? (
          <span className="text-xs text-muted-foreground">Guardando…</span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {roleCode} pasará los <code>requireRole([...])</code> que hoy pasa el
        rol heredado, sin necesidad de que un desarrollador toque código.
      </p>
      {serverError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {serverError}
        </p>
      ) : null}
    </div>
  );
}
