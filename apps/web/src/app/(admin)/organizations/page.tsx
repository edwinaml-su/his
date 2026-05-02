"use client";

/**
 * US-1.6 — Administración de organizaciones.
 * Tabla CRUD-readonly con la única acción operativa "Cambiar moneda funcional".
 * Gating ADMIN se aplica por fila (cliente) y se re-valida en el server.
 * TDR §5.2 — alta/edición completa queda para Sprint 2.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";
import { OrganizationRow, type OrgRowData } from "./organization-row";
import { OrganizationCurrencyDialog } from "./organization-currency-dialog";

export default function OrganizationsPage() {
  const query = trpc.organization.listAll.useQuery();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<OrgRowData | null>(null);

  function handleEdit(org: OrgRowData) {
    setSelected(org);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Organizaciones</h1>
        <p className="text-sm text-muted-foreground">
          Listado de organizaciones donde tienes membresía. Cambiar la moneda
          funcional requiere rol ADMIN.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuración por organización</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {query.isError && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{query.error.message}</AlertDescription>
            </Alert>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No tienes organizaciones asignadas.
            </p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre comercial</TableHead>
                  <TableHead>País</TableHead>
                  <TableHead>Moneda funcional</TableHead>
                  <TableHead>Moneda presentación</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((org) => (
                  <OrganizationRow
                    key={org.id}
                    org={org as OrgRowData}
                    onEditCurrency={handleEdit}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <OrganizationCurrencyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organization={selected}
      />
    </div>
  );
}
