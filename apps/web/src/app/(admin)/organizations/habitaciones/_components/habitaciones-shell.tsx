"use client";

/**
 * /organizations/habitaciones — CRUD admin de Room (espejo hospital.ward,
 * Odoo ACS HMS). Encargo de Edwin 2026-09-11. Mismo patrón que
 * `/organizations/establecimientos` (page Server Component + shell cliente
 * + dialog; roles vía getTenantContext).
 */
import * as React from "react";
import Link from "next/link";
import { BedDouble } from "lucide-react";
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
import { RoomDialog, type RoomData } from "./room-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ROLES_ADMIN_HABITACIONES = ["ADMIN", "DIR"];
const TODOS = "__todos__";

type RoomRow = RoomData & {
  active: boolean;
  establishment: { id: string; code: string; name: string };
  serviceUnit: { id: string; code: string; name: string };
};

export function HabitacionesShell({ roleCodes }: { roleCodes: string[] }) {
  const canManage = roleCodes.some((r) => ROLES_ADMIN_HABITACIONES.includes(r));

  const [establishmentFilter, setEstablishmentFilter] = React.useState<string>(TODOS);
  const establishments = trpcAny.establishment.list.useQuery();

  const query = trpcAny.room.list.useQuery({
    establishmentId: establishmentFilter === TODOS ? undefined : establishmentFilter,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<RoomData | null>(null);

  const setActive = trpcAny.room.setActive.useMutation({
    onSuccess: () => query.refetch(),
  });

  function handleCreate() {
    setSelected(null);
    setDialogOpen(true);
  }

  function handleEdit(row: RoomRow) {
    setSelected(row);
    setDialogOpen(true);
  }

  const rows = (query.data ?? []) as RoomRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BedDouble className="h-6 w-6" />
            Habitaciones
          </h1>
          <p className="text-sm text-muted-foreground">
            Habitaciones de la organización activa — espejo del modelo de Odoo (ward).
            Alta y edición requieren rol ADMIN o DIR.
          </p>
          <Link
            href="/organizations"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Volver a Organizaciones
          </Link>
        </div>
        {canManage ? (
          <Button onClick={handleCreate}>+ Nueva habitación</Button>
        ) : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">
            {query.isLoading ? "Cargando…" : `${rows.length} habitación(es)`}
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
              {(query.error as { message?: string })?.message ?? "Error al cargar habitaciones."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Establecimiento</TableHead>
                  <TableHead>Servicio</TableHead>
                  <TableHead className="w-32">Tipo</TableHead>
                  <TableHead className="w-32">GLN</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-48 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      Sin habitaciones registradas.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.code}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.establishment.code}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.serviceUnit.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.roomType}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.glnCodigo ?? "—"}
                    </TableCell>
                    <TableCell>
                      {row.active ? (
                        <Badge variant="success">Activa</Badge>
                      ) : (
                        <Badge variant="outline">Inactiva</Badge>
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

      <RoomDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        room={selected}
        onSaved={() => query.refetch()}
      />
    </div>
  );
}
