"use client";

/**
 * US-2.3 — Matriz de permisos por rol (tri-state ALLOW / UNSET / DENY).
 *
 * UX:
 *  - Permisos agrupados por `resource` (patient, encounter, triage, audit…).
 *  - Cada celda es un control "tri-state" controlado por radio buttons:
 *      o UNSET (default) → no se persiste fila en RolePermission.
 *      o ALLOW           → fila { effect: ALLOW }.
 *      o DENY            → fila { effect: DENY }.
 *  - Detección del estado actual:
 *      Map<permissionId, "ALLOW" | "DENY">  (state); ausencia ⇒ UNSET.
 *  - Acciones "Marcar todos ALLOW" / "Limpiar grupo" por resource para
 *    facilitar bulk edit.
 *  - "Guardar" envía la lista completa de pares { permissionId, effect } al
 *    server (los UNSET se omiten — el server hace upsert masivo y borra los
 *    que ya no figuran).
 *
 * Por qué tri-state:
 *  ALLOW = otorgado explícito, DENY = revocado explícito (gana sobre ALLOW
 *  por herencia futura), UNSET = no opina (se hereda del rol base / default).
 *  Hoy no hay herencia de roles, pero el modelo lo soporta con
 *  PermissionEffect ya en el schema (TDR §6.2).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Badge } from "@his/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";

type Effect = "ALLOW" | "DENY";
type TriState = Effect | "UNSET";

interface Permission {
  id: string;
  code: string;
  resource: string;
  action: string;
}

interface PermissionMatrixProps {
  roleId: string;
  roleCode: string;
  isGlobal: boolean;
  initial: { permissionId: string; effect: Effect }[];
}

export function PermissionMatrix({
  roleId,
  roleCode,
  isGlobal,
  initial,
}: PermissionMatrixProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const permsQ = (trpc as any).rbac.listPermissions.useQuery({});

  // Mapa permissionId → effect; ausencia = UNSET.
  const [state, setState] = React.useState<Map<string, Effect>>(() => {
    const m = new Map<string, Effect>();
    for (const p of initial) m.set(p.permissionId, p.effect);
    return m;
  });
  const [search, setSearch] = React.useState("");
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    variant?: "success" | "destructive";
  } | null>(null);

  React.useEffect(() => {
    const m = new Map<string, Effect>();
    for (const p of initial) m.set(p.permissionId, p.effect);
    setState(m);
  }, [initial]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utils = trpc.useUtils();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setMut = (trpc as any).rbac.setRolePermissions.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).rbac.getRole.invalidate({ id: roleId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).rbac.listRoles.invalidate();
      setToast({ title: "Permisos guardados", variant: "success" });
    },
    onError: (err: { message: string }) => {
      setServerError(err.message);
      setToast({ title: "Error al guardar", variant: "destructive" });
    },
  });

  const permissions = (permsQ.data ?? []) as Permission[];

  // Filtrado cliente.
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return permissions;
    return permissions.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.resource.toLowerCase().includes(q) ||
        p.action.toLowerCase().includes(q),
    );
  }, [permissions, search]);

  // Agrupado por resource.
  const grouped = React.useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of filtered) {
      const arr = map.get(p.resource) ?? [];
      arr.push(p);
      map.set(p.resource, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Detección de tri-state.
  function getTri(permissionId: string): TriState {
    return state.get(permissionId) ?? "UNSET";
  }

  function setTri(permissionId: string, value: TriState) {
    setState((prev) => {
      const next = new Map(prev);
      if (value === "UNSET") next.delete(permissionId);
      else next.set(permissionId, value);
      return next;
    });
  }

  function bulkSetGroup(resource: string, value: TriState) {
    setState((prev) => {
      const next = new Map(prev);
      for (const p of permissions) {
        if (p.resource !== resource) continue;
        if (value === "UNSET") next.delete(p.id);
        else next.set(p.id, value);
      }
      return next;
    });
  }

  function handleSave() {
    setServerError(null);
    const payload = Array.from(state, ([permissionId, effect]) => ({
      permissionId,
      effect,
    }));
    setMut.mutate({ roleId, permissions: payload });
  }

  // Resumen para el header.
  const allowCount = Array.from(state.values()).filter((e) => e === "ALLOW").length;
  const denyCount = Array.from(state.values()).filter((e) => e === "DENY").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filtrar permisos por código, recurso o acción…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="success">{allowCount} ALLOW</Badge>
          <Badge variant="destructive">{denyCount} DENY</Badge>
          <span className="text-muted-foreground">
            de {permissions.length} permisos
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isGlobal ? (
            <Badge variant="info">
              Global · requiere super_admin para guardar
            </Badge>
          ) : null}
          <Button onClick={handleSave} disabled={setMut.isPending}>
            {setMut.isPending ? "Guardando…" : "Guardar permisos"}
          </Button>
        </div>
      </div>

      {serverError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </p>
      ) : null}

      {permsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando catálogo…</p>
      ) : null}

      <div className="space-y-4">
        {grouped.map(([resource, perms]) => (
          <Card key={resource}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {resource}{" "}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({perms.length})
                </span>
              </CardTitle>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => bulkSetGroup(resource, "ALLOW")}
                >
                  Allow todo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => bulkSetGroup(resource, "UNSET")}
                >
                  Limpiar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {perms.map((p) => {
                const tri = getTri(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-muted-foreground">
                        {p.code}
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">
                          {p.resource}.
                        </span>
                        <span className="font-medium">{p.action}</span>
                      </div>
                    </div>
                    <fieldset
                      className="inline-flex items-center gap-3 text-xs"
                      aria-label={`Permiso ${p.code} para ${roleCode}`}
                    >
                      {(["ALLOW", "UNSET", "DENY"] as TriState[]).map((opt) => (
                        <label
                          key={opt}
                          className={`flex items-center gap-1 ${
                            tri === opt ? "font-semibold" : "text-muted-foreground"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`perm-${p.id}`}
                            checked={tri === opt}
                            onChange={() => setTri(p.id, opt)}
                            className="h-3.5 w-3.5"
                          />
                          {opt}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
        {grouped.length === 0 && !permsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Sin permisos que coincidan con el filtro.
          </p>
        ) : null}
      </div>

      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            <ToastDescription>
              {toast.variant === "success"
                ? `${allowCount} permisos ALLOW + ${denyCount} DENY guardados.`
                : "Revisa los detalles del error."}
            </ToastDescription>
          </div>
        </Toast>
      ) : null}
    </div>
  );
}
