"use client";

/**
 * /afiliados — CRUD admin de MedicoAfiliado (CC-0036 Ola 1B,
 * REQ-HIS-AFIL-001 US.AFIL.1.2). Mismo patrón que `/consultorios`. RBAC real
 * vía `medico_afiliado.*` en el router — `roleCodes` acá solo gobierna la
 * UX (botones); el 403 real lo da el server.
 */
import * as React from "react";
import { BriefcaseMedical } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";
import { AfiliadoDialog, type AfiliadoData } from "./afiliado-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ROLES_ADMIN_AFILIADOS = ["ADMIN", "DIR", "ADMIN_CONSULTORIOS"];
const TODOS = "__todos__";

const ESTADO_BADGE: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  PROSPECTO: "outline",
  ACTIVO: "success",
  SUSPENDIDO: "warning",
  INACTIVO: "destructive",
};

type AfiliadoRow = AfiliadoData & {
  especialidadPrincipal: { id: string; name: string } | null;
};

export function AfiliadosShell({ roleCodes }: { roleCodes: string[] }) {
  const canManage = roleCodes.some((r) => ROLES_ADMIN_AFILIADOS.includes(r));

  const [estadoFilter, setEstadoFilter] = React.useState<string>(TODOS);
  const query = trpcAny.medicoAfiliado.list.useQuery({
    estado: estadoFilter === TODOS ? undefined : estadoFilter,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<AfiliadoData | null>(null);
  const [bajaTarget, setBajaTarget] = React.useState<AfiliadoRow | null>(null);
  const [fechaBaja, setFechaBaja] = React.useState("");
  const [motivoBaja, setMotivoBaja] = React.useState("");
  const [bajaError, setBajaError] = React.useState<string | null>(null);

  const activar = trpcAny.medicoAfiliado.activar.useMutation({ onSuccess: () => query.refetch() });
  const darBaja = trpcAny.medicoAfiliado.darBaja.useMutation({
    onSuccess: () => {
      query.refetch();
      setBajaTarget(null);
    },
    onError: (err: { message: string }) => setBajaError(err.message),
  });

  function handleCreate() {
    setSelected(null);
    setDialogOpen(true);
  }

  function handleEdit(row: AfiliadoRow) {
    setSelected(row);
    setDialogOpen(true);
  }

  function openBaja(row: AfiliadoRow) {
    setBajaTarget(row);
    setFechaBaja("");
    setMotivoBaja("");
    setBajaError(null);
  }

  function submitBaja() {
    if (!bajaTarget || !fechaBaja || motivoBaja.trim().length === 0) return;
    setBajaError(null);
    darBaja.mutate({ id: bajaTarget.id, fechaBaja, motivoBaja: motivoBaja.trim() });
  }

  const rows = (query.data ?? []) as AfiliadoRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BriefcaseMedical className="h-6 w-6" />
            Médicos Afiliados
          </h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de médicos especialistas afiliados — contraparte económica del hospital
            (REQ-HIS-AFIL-001 US.AFIL.1.2). Alta y edición requieren rol ADMIN, DIR o
            ADMIN_CONSULTORIOS.
          </p>
        </div>
        {canManage ? <Button onClick={handleCreate}>+ Nuevo afiliado</Button> : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">
            {query.isLoading ? "Cargando…" : `${rows.length} afiliado(s)`}
          </CardTitle>
          <div className="w-56">
            <Select value={estadoFilter} onValueChange={setEstadoFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Todos los estados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos los estados</SelectItem>
                <SelectItem value="PROSPECTO">Prospecto</SelectItem>
                <SelectItem value="ACTIVO">Activo</SelectItem>
                <SelectItem value="SUSPENDIDO">Suspendido</SelectItem>
                <SelectItem value="INACTIVO">Inactivo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {query.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(query.error as { message?: string })?.message ?? "Error al cargar afiliados."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-28">JVPM</TableHead>
                  <TableHead>Especialidad</TableHead>
                  <TableHead className="w-40">Tipo de relación</TableHead>
                  <TableHead className="w-28">Estado</TableHead>
                  <TableHead className="w-64 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Sin médicos afiliados registrados.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.nombreCompleto}</TableCell>
                    <TableCell className="font-mono text-sm">{row.jvpmNumero}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.especialidadPrincipal?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.tipoRelacion}</TableCell>
                    <TableCell>
                      <Badge variant={ESTADO_BADGE[row.estado] ?? "outline"}>{row.estado}</Badge>
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
                        {row.estado === "PROSPECTO" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canManage || activar.isPending}
                            title={
                              !canManage
                                ? "Requiere rol ADMIN, DIR o ADMIN_CONSULTORIOS"
                                : "Decisión temporal Ola 1B: sin gate de contrato/convenio todavía"
                            }
                            onClick={() => activar.mutate({ id: row.id })}
                          >
                            Activar
                          </Button>
                        ) : null}
                        {row.estado === "ACTIVO" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canManage}
                            title={!canManage ? "Requiere rol ADMIN, DIR o ADMIN_CONSULTORIOS" : "Dar de baja"}
                            onClick={() => openBaja(row)}
                          >
                            Dar de baja
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AfiliadoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        afiliado={selected}
        onSaved={() => query.refetch()}
      />

      <Dialog open={bajaTarget !== null} onOpenChange={(v) => !v && setBajaTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dar de baja a {bajaTarget?.nombreCompleto}</DialogTitle>
            <DialogDescription>
              Requiere fecha y motivo de baja (US.AFIL.1.2 AC4). El afiliado pasa a INACTIVO.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="baja-fecha">Fecha de baja</Label>
              <Input
                id="baja-fecha"
                type="date"
                value={fechaBaja}
                onChange={(e) => setFechaBaja(e.target.value)}
                disabled={darBaja.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="baja-motivo">Motivo</Label>
              <Textarea
                id="baja-motivo"
                value={motivoBaja}
                onChange={(e) => setMotivoBaja(e.target.value)}
                disabled={darBaja.isPending}
                maxLength={300}
                rows={3}
              />
            </div>
            {bajaError && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{bajaError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setBajaTarget(null)} disabled={darBaja.isPending}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={submitBaja}
              disabled={darBaja.isPending || !fechaBaja || motivoBaja.trim().length === 0}
            >
              {darBaja.isPending ? "Guardando…" : "Confirmar baja"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
