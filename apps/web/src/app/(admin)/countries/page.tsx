"use client";

/**
 * US-1.1 — /countries — CRUD de países (super-admin TI).
 *
 * Renderiza header + tabla + dialog de form. La validación de
 * "no desactivar país con organizaciones activas" se hace en el router
 * (TRPCError BAD_REQUEST) y se muestra al usuario vía toast destructivo.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { CountryTable, type CountryRow } from "./country-table";
import { CountryForm } from "./country-form";

export default function CountriesPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CountryRow | undefined>(undefined);

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  const openEdit = (row: CountryRow) => {
    setEditing(row);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Países</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo maestro ISO 3166-1 alpha-3 con timezone, locale y moneda funcional.
          </p>
        </div>
        <Button onClick={openCreate}>+ Nuevo país</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registros</CardTitle>
        </CardHeader>
        <CardContent>
          <CountryTable onEdit={openEdit} />
        </CardContent>
      </Card>

      <CountryForm
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialValue={editing}
      />
    </div>
  );
}
