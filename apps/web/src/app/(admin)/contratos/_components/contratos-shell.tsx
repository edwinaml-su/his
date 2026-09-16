"use client";

/**
 * /contratos — CC-0036 Ola 2 (REQ-HIS-AFIL-001 S2, US.AFIL.1.3/1.4). Listado
 * de `ContratoArrendamiento` + alta + detalle (jornadas, cargos, activar/
 * terminar/mora). Mismo patrón que `/consultorios` y `/afiliados`: Server
 * Component resuelve `roleCodes`, este shell decide la UX de botones — RBAC
 * real vía `contrato_arrendamiento.*`/`contrato_cargo.*` en el router.
 */
import * as React from "react";
import { FileSignature } from "lucide-react";
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
import { ContratoDialog } from "./contrato-dialog";
import { ContratoDetailDialog } from "./contrato-detail-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ROLES_ADMIN_CONSULTORIOS = ["ADMIN", "DIR", "ADMIN_CONSULTORIOS"];
const TODOS = "__todos__";

const ESTADO_BADGE: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  BORRADOR: "outline",
  VIGENTE: "success",
  EN_MORA: "warning",
  SUSPENDIDO: "warning",
  TERMINADO: "destructive",
  RENOVADO: "success",
};

type ContratoRow = {
  id: string;
  folio: string;
  modalidad: string;
  estado: string;
  rentaMensual: string | number;
  fechaInicio: string;
  medicoAfiliado: { nombreCompleto: string };
  consultorio: { codigo: string; nombre: string };
};

export function ContratosShell({ roleCodes }: { roleCodes: string[] }) {
  const canManage = roleCodes.some((r) => ROLES_ADMIN_CONSULTORIOS.includes(r));

  const [estadoFilter, setEstadoFilter] = React.useState<string>(TODOS);
  const query = trpcAny.contrato.list.useQuery({
    estado: estadoFilter === TODOS ? undefined : estadoFilter,
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  const rows = (query.data ?? []) as ContratoRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileSignature className="h-6 w-6" />
            Contratos de arrendamiento
          </h1>
          <p className="text-sm text-muted-foreground">
            Contratos de consultorios con médicos afiliados y devengo mensual al hub de eventos
            (REQ-HIS-AFIL-001 US.AFIL.1.3/1.4). Alta y transiciones requieren rol ADMIN, DIR o
            ADMIN_CONSULTORIOS.
          </p>
        </div>
        {canManage ? <Button onClick={() => setCreateOpen(true)}>+ Nuevo contrato</Button> : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">
            {query.isLoading ? "Cargando…" : `${rows.length} contrato(s)`}
          </CardTitle>
          <div className="w-56">
            <Select value={estadoFilter} onValueChange={setEstadoFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Todos los estados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos los estados</SelectItem>
                {Object.keys(ESTADO_BADGE).map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {query.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(query.error as { message?: string })?.message ?? "Error al cargar contratos."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Folio</TableHead>
                  <TableHead>Médico afiliado</TableHead>
                  <TableHead>Consultorio</TableHead>
                  <TableHead className="w-40">Modalidad</TableHead>
                  <TableHead className="w-24">Renta</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-32 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Sin contratos registrados.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.folio}</TableCell>
                    <TableCell className="font-medium">{row.medicoAfiliado.nombreCompleto}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.consultorio.codigo} — {row.consultorio.nombre}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.modalidad}</Badge>
                    </TableCell>
                    <TableCell>{String(row.rentaMensual)}</TableCell>
                    <TableCell>
                      <Badge variant={ESTADO_BADGE[row.estado] ?? "outline"}>{row.estado}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setDetailId(row.id)}>
                        Ver / Gestionar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ContratoDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={() => query.refetch()} />
      <ContratoDetailDialog
        contratoId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        canManage={canManage}
        onChanged={() => query.refetch()}
      />
    </div>
  );
}
