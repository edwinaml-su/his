"use client";

/**
 * /organizations/camas — CRUD admin de Bed (extensión, no router paralelo)
 * con los campos espejo Odoo ACS HMS: roomId, bedType, billingClass, GLN.
 * Encargo de Edwin 2026-09-11. Mismo patrón que `/organizations/habitaciones`.
 */
import * as React from "react";
import Link from "next/link";
import { Bed as BedIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import { BedDialog, type BedData } from "./bed-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ROLES_ADMIN_CAMAS = ["ADMIN", "DIR"];
const TODOS = "__todos__";

type BedRow = BedData & {
  active: boolean;
  status: string;
  establishment: { id: string; code: string; name: string };
  serviceUnit: { id: string; code: string; name: string };
  roomRef: { id: string; code: string; name: string } | null;
};

export function CamasShell({ roleCodes }: { roleCodes: string[] }) {
  const canManage = roleCodes.some((r) => ROLES_ADMIN_CAMAS.includes(r));

  const [establishmentFilter, setEstablishmentFilter] = React.useState<string>(TODOS);
  const establishments = trpcAny.establishment.list.useQuery();

  const query = trpcAny.bed.adminList.useQuery({
    establishmentId: establishmentFilter === TODOS ? undefined : establishmentFilter,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<BedData | null>(null);

  const setActive = trpcAny.bed.setActive.useMutation({
    onSuccess: () => query.refetch(),
  });

  function handleCreate() {
    setSelected(null);
    setDialogOpen(true);
  }

  function handleEdit(row: BedRow) {
    setSelected(row);
    setDialogOpen(true);
  }

  const rows = (query.data ?? []) as BedRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BedIcon className="h-6 w-6" />
            Camas
          </h1>
          <p className="text-sm text-muted-foreground">
            Camas de la organización activa — tipo, clase de facturación y habitación
            (espejo Odoo). Alta y edición requieren rol ADMIN o DIR.
          </p>
          <Link
            href="/organizations"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Volver a Organizaciones
          </Link>
        </div>
        {canManage ? <Button onClick={handleCreate}>+ Nueva cama</Button> : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">
            {query.isLoading ? "Cargando…" : `${rows.length} cama(s)`}
          </CardTitle>
          <div className="w-56">
            <Select value={establishmentFilter} onValueChange={setEstablishmentFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Todos los establecimientos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos los establecimientos</SelectItem>
                {(establishments.data ?? []).map((e: { id: string; code: string; name: string }) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.code} — {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {query.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(query.error as { message?: string })?.message ?? "Error al cargar camas."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Código</TableHead>
                  <TableHead>Establecimiento</TableHead>
                  <TableHead>Servicio</TableHead>
                  <TableHead>Habitación</TableHead>
                  <TableHead className="w-32">Tipo de cama</TableHead>
                  <TableHead className="w-28">Facturación</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-24">Activa</TableHead>
                  <TableHead className="w-48 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      Sin camas registradas.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.code}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.establishment.code}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.serviceUnit.name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.roomRef?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {row.bedType ? <Badge variant="outline">{row.bedType}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.billingClass ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.active ? (
                        <Badge variant="success">Sí</Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
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

      <BedDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        bed={selected}
        onSaved={() => query.refetch()}
      />
    </div>
  );
}
