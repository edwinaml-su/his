"use client";

/**
 * US-2.3 — Detalle de rol con matriz de permisos.
 * Layout: header con metadatos + matriz tri-state + botón volver.
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { trpc } from "@/lib/trpc/react";
import { PermissionMatrix } from "../permission-matrix";

type RoleDetail = {
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  permissions: {
    permissionId: string;
    effect: "ALLOW" | "DENY";
    permission: { id: string; code: string; resource: string; action: string };
  }[];
};

export default function RoleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (trpc as any).rbac.getRole.useQuery({ id }, { enabled: !!id });
  const role = query.data as RoleDetail | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/roles" className="hover:underline">
              ← Volver a roles
            </Link>
          </div>
          <h1 className="text-2xl font-bold">
            {role ? role.name : "Cargando rol…"}
          </h1>
          {role ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <code className="font-mono">{role.code}</code>
              {role.organizationId === null ? (
                <Badge variant="info">Global</Badge>
              ) : (
                <Badge variant="secondary">Org</Badge>
              )}
              {role.active ? (
                <Badge variant="success">Activo</Badge>
              ) : (
                <Badge variant="outline">Inactivo</Badge>
              )}
            </div>
          ) : null}
          {role?.description ? (
            <p className="mt-2 text-sm text-muted-foreground">{role.description}</p>
          ) : null}
        </div>
        <Button asChild variant="outline">
          <Link href="/roles">Cerrar</Link>
        </Button>
      </div>

      {query.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Error: {query.error.message}
        </p>
      ) : null}

      {role ? (
        <Card>
          <CardHeader>
            <CardTitle>Permisos</CardTitle>
          </CardHeader>
          <CardContent>
            <PermissionMatrix
              roleId={role.id}
              roleCode={role.code}
              isGlobal={role.organizationId === null}
              initial={role.permissions.map((p) => ({
                permissionId: p.permissionId,
                effect: p.effect,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
