"use client";

/**
 * /consultorios — CRUD admin de Consultorio (CC-0036 Ola 1B,
 * REQ-HIS-AFIL-001 US.AFIL.1.1). Mismo patrón que
 * `/organizations/habitaciones` (page Server Component + shell cliente +
 * dialog; roles vía getTenantContext). RBAC real vía `consultorio.*` en el
 * router — `roleCodes` acá solo gobierna la UX del botón de alta.
 */
import * as React from "react";
import { DoorOpen } from "lucide-react";
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
import { ConsultorioDialog, type ConsultorioData } from "./consultorio-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ROLES_ADMIN_CONSULTORIOS = ["ADMIN", "DIR", "ADMIN_CONSULTORIOS"];
const TODOS = "__todos__";

type ConsultorioRow = ConsultorioData & {
  active: boolean;
  establishment: { id: string; code: string; name: string };
  serviceUnit: { id: string; code: string; name: string } | null;
};

export function ConsultoriosShell({ roleCodes }: { roleCodes: string[] }) {
  const canManage = roleCodes.some((r) => ROLES_ADMIN_CONSULTORIOS.includes(r));

  const [establishmentFilter, setEstablishmentFilter] = React.useState<string>(TODOS);
  const establishments = trpcAny.establishment.list.useQuery();

  const query = trpcAny.consultorio.list.useQuery({
    establishmentId: establishmentFilter === TODOS ? undefined : establishmentFilter,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<ConsultorioData | null>(null);

  const setActive = trpcAny.consultorio.setActive.useMutation({
    onSuccess: () => query.refetch(),
  });

  function handleCreate() {
    setSelected(null);
    setDialogOpen(true);
  }

  function handleEdit(row: ConsultorioRow) {
    setSelected(row);
    setDialogOpen(true);
  }

  const rows = (query.data ?? []) as ConsultorioRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <DoorOpen className="h-6 w-6" />
            Consultorios
          </h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de consultorios por sede (REQ-HIS-AFIL-001 US.AFIL.1.1). Alta y edición
            requieren rol ADMIN, DIR o ADMIN_CONSULTORIOS.
          </p>
        </div>
        {canManage ? <Button onClick={handleCreate}>+ Nuevo consultorio</Button> : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">
            {query.isLoading ? "Cargando…" : `${rows.length} consultorio(s)`}
          </CardTitle>
          <div className="w-56">
            <Select value={establishmentFilter} onValueChange={setEstablishmentFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Todas las sedes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas las sedes</SelectItem>
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
              {(query.error as { message?: string })?.message ?? "Error al cargar consultorios."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Sede</TableHead>
                  <TableHead>Servicio</TableHead>
                  <TableHead className="w-28">Tipo de uso</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-48 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Sin consultorios registrados.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.codigo}</TableCell>
                    <TableCell className="font-medium">{row.nombre}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.establishment.code}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.serviceUnit?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.tipoUso}</Badge>
                    </TableCell>
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
                          title={!canManage ? "Requiere rol ADMIN, DIR o ADMIN_CONSULTORIOS" : "Editar"}
                          onClick={() => handleEdit(row)}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage || setActive.isPending}
                          title={!canManage ? "Requiere rol ADMIN, DIR o ADMIN_CONSULTORIOS" : undefined}
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

      <ConsultorioDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        consultorio={selected}
        onSaved={() => query.refetch()}
      />
    </div>
  );
}
