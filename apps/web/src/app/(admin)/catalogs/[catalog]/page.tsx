"use client";

/**
 * US-3.2 — CRUD UI genérico para catálogos personas (TDR §7).
 *
 * Resuelve el slug de la URL contra `CATALOGS` (catalog-config.ts). Si no existe
 * → 404. Renderiza header + tabla + dialog de form.
 *
 * Navegación entre catálogos: por ahora se accede vía URL directa
 * (`/catalogs/<slug>`). El menú lateral del AdminLayout debería listar slugs
 * disponibles — TODO(Sprint 2) si aún no lo hace.
 */
import * as React from "react";
import { useParams, notFound } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { CatalogTable } from "./catalog-table";
import { CatalogForm } from "./catalog-form";
import { getCatalogConfig } from "./catalog-config";

type Row = Record<string, unknown> & { id: string };

export default function CatalogPage() {
  const params = useParams<{ catalog: string }>();
  const slug = params.catalog;
  const config = getCatalogConfig(slug);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | undefined>(undefined);

  if (!config) {
    notFound();
  }

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{config.label}</h1>
          <p className="text-sm text-muted-foreground">{config.description}</p>
        </div>
        <Button onClick={openCreate}>+ Nuevo</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registros</CardTitle>
        </CardHeader>
        <CardContent>
          <CatalogTable config={config} onEdit={openEdit} />
        </CardContent>
      </Card>

      <CatalogForm
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        config={config}
        initialValue={editing}
      />
    </div>
  );
}
