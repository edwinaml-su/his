"use client";

/**
 * /agendas — CC-0036 Ola 3 (REQ-HIS-AFIL-001 S3, US.AGE.2.1/2.2/2.3).
 * Listado de `AgendaMedico` + alta + detalle (horarios, excepciones,
 * disponibilidad). Mismo patrón que `/contratos`: Server Component resuelve
 * `roleCodes`, este shell decide la UX de botones — RBAC real vía
 * `agenda.leer/configurar/publicar` en el router.
 */
import * as React from "react";
import { CalendarClock } from "lucide-react";
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
import { AgendaDialog } from "./agenda-dialog";
import { AgendaDetailDialog } from "./agenda-detail-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ROLES_CONFIGURAN = ["ADMIN", "DIR", "ADMIN_CONSULTORIOS"];
const TODOS = "__todos__";

const ESTADO_BADGE: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  BORRADOR: "outline",
  PUBLICADA: "success",
  SUSPENDIDA: "warning",
  CERRADA: "destructive",
};

type AgendaRow = {
  id: string;
  estado: string;
  estadoEfectivo: string;
  duracionSlotMin: number;
  medicoAfiliado: { nombreCompleto: string };
  consultorio: { codigo: string; nombre: string };
  contrato: { estado: string } | null;
};

export function AgendasShell({ roleCodes }: { roleCodes: string[] }) {
  const canConfigure = roleCodes.some((r) => ROLES_CONFIGURAN.includes(r));

  const [estadoFilter, setEstadoFilter] = React.useState<string>(TODOS);
  const query = trpcAny.agenda.list.useQuery({
    estado: estadoFilter === TODOS ? undefined : estadoFilter,
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  const rows = (query.data ?? []) as AgendaRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarClock className="h-6 w-6" />
            Agendas médicas
          </h1>
          <p className="text-sm text-muted-foreground">
            Configuración de agenda, excepciones y disponibilidad derivada por médico afiliado y
            consultorio (REQ-HIS-AFIL-001 US.AGE.2.1/2.2/2.3). El estado &quot;SUSPENDIDA&quot; puede
            derivarse automáticamente si el contrato de arrendamiento asociado entra en mora.
          </p>
        </div>
        {canConfigure ? <Button onClick={() => setCreateOpen(true)}>+ Nueva agenda</Button> : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">
            {query.isLoading ? "Cargando…" : `${rows.length} agenda(s)`}
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
              {(query.error as { message?: string })?.message ?? "Error al cargar agendas."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Médico afiliado</TableHead>
                  <TableHead>Consultorio</TableHead>
                  <TableHead className="w-24">Slot</TableHead>
                  <TableHead className="w-32">Estado</TableHead>
                  <TableHead className="w-32 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Sin agendas registradas.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.medicoAfiliado.nombreCompleto}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.consultorio.codigo} — {row.consultorio.nombre}
                    </TableCell>
                    <TableCell>{row.duracionSlotMin} min</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={ESTADO_BADGE[row.estadoEfectivo] ?? "outline"}>
                          {row.estadoEfectivo}
                        </Badge>
                        {row.estadoEfectivo !== row.estado ? (
                          <span className="text-xs text-muted-foreground">
                            (persistido: {row.estado} — suspendida por mora del contrato)
                          </span>
                        ) : null}
                      </div>
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

      <AgendaDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={() => query.refetch()} />
      <AgendaDetailDialog
        agendaId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        canConfigure={canConfigure}
        onChanged={() => query.refetch()}
      />
    </div>
  );
}
