"use client";

/**
 * /organizations/establecimientos — CRUD admin (parametrización 2026-09-10).
 * `roleCodes` se resuelve server-side en `page.tsx` (mismo patrón que
 * `finance/invoices/nuevo` / `finance/price-lists`).
 */
import * as React from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import { EstablishmentDialog, type EstablishmentData } from "./establishment-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ROLES_ADMIN_ESTABLECIMIENTOS = ["ADMIN", "DIR"];

type EstablishmentRow = EstablishmentData & { active: boolean };

export function EstablecimientosShell({ roleCodes }: { roleCodes: string[] }) {
  const canManage = roleCodes.some((r) => ROLES_ADMIN_ESTABLECIMIENTOS.includes(r));

  const query = trpcAny.establishment.list.useQuery();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<EstablishmentData | null>(null);

  const setActive = trpcAny.establishment.setActive.useMutation({
    onSuccess: () => query.refetch(),
  });

  function handleCreate() {
    setSelected(null);
    setDialogOpen(true);
  }

  function handleEdit(row: EstablishmentRow) {
    setSelected(row);
    setDialogOpen(true);
  }

  const rows = (query.data ?? []) as EstablishmentRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Building2 className="h-6 w-6" />
            Establecimientos
          </h1>
          <p className="text-sm text-muted-foreground">
            Establecimientos de la organización activa. Alta y edición requieren rol ADMIN o DIR.
          </p>
          <Link
            href="/organizations"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Volver a Organizaciones
          </Link>
        </div>
        {canManage ? (
          <Button onClick={handleCreate}>+ Nuevo establecimiento</Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {query.isLoading ? "Cargando…" : `${rows.length} establecimiento(s)`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(query.error as { message?: string })?.message ?? "Error al cargar establecimientos."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead className="w-36">Teléfono</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-48 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Sin establecimientos registrados.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.code}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.addressLine ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.phone ?? "—"}</TableCell>
                    <TableCell>
                      {row.active ? (
                        <Badge variant="success">Activo</Badge>
                      ) : (
                        <Badge variant="outline">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage}
                          title={!canManage ? "Requiere rol ADMIN o DIR" : "Editar"}
                          onClick={() => handleEdit(row)}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage || setActive.isPending}
                          title={!canManage ? "Requiere rol ADMIN o DIR" : undefined}
                          onClick={() => setActive.mutate({ id: row.id, active: !row.active })}
                        >
                          {row.active ? "Desactivar" : "Activar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <EstablishmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        establishment={selected}
        onSaved={() => query.refetch()}
      />
    </div>
  );
}
