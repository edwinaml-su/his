"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

/**
 * Gestión de organizaciones (TDR §5.2). MVP: listado de las propias del usuario.
 * TODO(Sprint 2): alta/edición de organizaciones (solo ADMIN global).
 */
export default function OrganizationsPage() {
  const query = trpc.organization.listMine.useQuery();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Organizaciones</h1>
        <p className="text-sm text-muted-foreground">Tus membresías activas.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Mis organizaciones</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Razón social</TableHead>
                  <TableHead>Nombre comercial</TableHead>
                  <TableHead>NIT</TableHead>
                  <TableHead>Roles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>{org.legalName}</TableCell>
                    <TableCell>{org.tradeName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{org.taxId}</TableCell>
                    <TableCell className="text-xs">{org.roles.join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
