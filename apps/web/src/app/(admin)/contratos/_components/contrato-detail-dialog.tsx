"use client";

/**
 * Detalle de contrato — CC-0036 Ola 2 (REQ-HIS-AFIL-001 US.AFIL.1.3/1.4).
 * Jornadas (solo COMPARTIDO_POR_JORNADA), cargos devengados, y las
 * transiciones activar/terminar/marcar-mora con confirmación inline (sin
 * `window.confirm`, consistente con el resto del admin).
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
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
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const DIAS_SEMANA_LABEL: Record<number, string> = {
  0: "Domingo",
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
};

const ESTADO_BADGE: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  BORRADOR: "outline",
  VIGENTE: "success",
  EN_MORA: "warning",
  SUSPENDIDO: "warning",
  TERMINADO: "destructive",
  RENOVADO: "success",
};

type Confirmando = "activar" | "terminar" | "mora" | "desmora" | null;

type Props = {
  contratoId: string | null;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onChanged: () => void;
};

export function ContratoDetailDialog({ contratoId, onOpenChange, canManage, onChanged }: Props) {
  const open = contratoId !== null;
  const [confirmando, setConfirmando] = React.useState<Confirmando>(null);
  const [fechaEfectiva, setFechaEfectiva] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [nuevaJornada, setNuevaJornada] = React.useState({ diaSemana: "1", horaInicio: "08:00", horaFin: "17:00" });
  const [periodoGenerar, setPeriodoGenerar] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setConfirmando(null);
      setFechaEfectiva("");
      setMotivo("");
      setErrorMsg(null);
    }
  }, [open]);

  const query = trpcAny.contrato.get.useQuery({ id: contratoId }, { enabled: open });
  const cargos = trpcAny.contrato.cargo.list.useQuery({ contratoId }, { enabled: open });

  function refetchAll() {
    query.refetch();
    cargos.refetch();
    onChanged();
  }

  const onErr = (err: { message: string }) => setErrorMsg(err.message);

  const activarM = trpcAny.contrato.activar.useMutation({
    onSuccess: () => {
      setConfirmando(null);
      refetchAll();
    },
    onError: onErr,
  });
  const terminarM = trpcAny.contrato.terminar.useMutation({
    onSuccess: () => {
      setConfirmando(null);
      refetchAll();
    },
    onError: onErr,
  });
  const marcarMoraM = trpcAny.contrato.marcarMora.useMutation({
    onSuccess: () => {
      setConfirmando(null);
      refetchAll();
    },
    onError: onErr,
  });
  const desmarcarMoraM = trpcAny.contrato.desmarcarMora.useMutation({
    onSuccess: () => {
      setConfirmando(null);
      refetchAll();
    },
    onError: onErr,
  });
  const jornadaCreateM = trpcAny.contrato.jornada.create.useMutation({
    onSuccess: () => refetchAll(),
    onError: onErr,
  });
  const jornadaDeleteM = trpcAny.contrato.jornada.delete.useMutation({
    onSuccess: () => refetchAll(),
    onError: onErr,
  });
  const cargoGenerarM = trpcAny.contrato.cargo.generar.useMutation({
    onSuccess: () => refetchAll(),
    onError: onErr,
  });
  const cargoAnularM = trpcAny.contrato.cargo.anular.useMutation({
    onSuccess: () => refetchAll(),
    onError: onErr,
  });

  const contrato = query.data as
    | {
        id: string;
        folio: string;
        estado: string;
        modalidad: "EXCLUSIVO" | "COMPARTIDO_POR_JORNADA";
        fechaInicio: string;
        fechaFin: string | null;
        rentaMensual: string | number;
        cuotaServicios: string | number;
        medicoAfiliado: { nombreCompleto: string; jvpmNumero: string };
        consultorio: { codigo: string; nombre: string };
        jornadas: Array<{ id: string; diaSemana: number; horaInicio: string; horaFin: string }>;
      }
    | undefined;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onOpenChange(false)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{contrato ? `Contrato ${contrato.folio}` : "Contrato"}</DialogTitle>
          <DialogDescription>
            {contrato ? `${contrato.medicoAfiliado.nombreCompleto} — ${contrato.consultorio.codigo}` : "Cargando…"}
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {contrato ? (
          <div className="space-y-5 py-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant={ESTADO_BADGE[contrato.estado] ?? "outline"}>{contrato.estado}</Badge>
              <span className="text-muted-foreground">{contrato.modalidad}</span>
              <span>
                Renta: {String(contrato.rentaMensual)} · Servicios: {String(contrato.cuotaServicios)}
              </span>
              <span className="text-muted-foreground">
                {contrato.fechaInicio.slice(0, 10)} — {contrato.fechaFin ? contrato.fechaFin.slice(0, 10) : "sin fin"}
              </span>
            </div>

            {canManage ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap gap-2">
                  {contrato.estado === "BORRADOR" ? (
                    <Button size="sm" onClick={() => setConfirmando("activar")}>
                      Activar
                    </Button>
                  ) : null}
                  {contrato.estado === "VIGENTE" || contrato.estado === "EN_MORA" ? (
                    <Button size="sm" variant="destructive" onClick={() => setConfirmando("terminar")}>
                      Terminar
                    </Button>
                  ) : null}
                  {contrato.estado === "VIGENTE" ? (
                    <Button size="sm" variant="outline" onClick={() => setConfirmando("mora")}>
                      Marcar EN_MORA
                    </Button>
                  ) : null}
                  {contrato.estado === "EN_MORA" ? (
                    <Button size="sm" variant="outline" onClick={() => setConfirmando("desmora")}>
                      Quitar EN_MORA
                    </Button>
                  ) : null}
                </div>

                {confirmando === "activar" ? (
                  <Alert>
                    <AlertTitle>Confirmar activación</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <p>
                        Se generará el devengo prorrateado del período en curso y se emitirá el evento de
                        dominio. ¿Confirmas activar el contrato {contrato.folio}?
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={activarM.isPending}
                          onClick={() => activarM.mutate({ id: contrato.id })}
                        >
                          {activarM.isPending ? "Activando…" : "Confirmar"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmando(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : null}

                {confirmando === "terminar" ? (
                  <Alert variant="destructive">
                    <AlertTitle>Terminar contrato</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label htmlFor="term-fecha">Fecha efectiva</Label>
                          <Input
                            id="term-fecha"
                            type="date"
                            value={fechaEfectiva}
                            onChange={(e) => setFechaEfectiva(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="term-motivo">Motivo</Label>
                          <Input id="term-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={terminarM.isPending || !fechaEfectiva || !motivo.trim()}
                          onClick={() =>
                            terminarM.mutate({ id: contrato.id, fechaEfectiva, motivo: motivo.trim() })
                          }
                        >
                          {terminarM.isPending ? "Terminando…" : "Confirmar término"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmando(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : null}

                {confirmando === "mora" || confirmando === "desmora" ? (
                  <Alert>
                    <AlertTitle>
                      {confirmando === "mora" ? "Marcar EN_MORA (manual)" : "Quitar EN_MORA (manual)"}
                    </AlertTitle>
                    <AlertDescription className="space-y-2">
                      <div className="space-y-1">
                        <Label htmlFor="mora-motivo">Motivo</Label>
                        <Input id="mora-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={
                            (confirmando === "mora" ? marcarMoraM.isPending : desmarcarMoraM.isPending) ||
                            !motivo.trim()
                          }
                          onClick={() =>
                            confirmando === "mora"
                              ? marcarMoraM.mutate({ id: contrato.id, motivo: motivo.trim() })
                              : desmarcarMoraM.mutate({ id: contrato.id, motivo: motivo.trim() })
                          }
                        >
                          Confirmar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmando(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}

            {contrato.modalidad === "COMPARTIDO_POR_JORNADA" ? (
              <div className="space-y-2">
                <Label>Jornadas contratadas</Label>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Día</TableHead>
                        <TableHead>Inicio</TableHead>
                        <TableHead>Fin</TableHead>
                        {canManage ? <TableHead className="text-right">Acciones</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contrato.jornadas.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                            Sin jornadas registradas.
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {contrato.jornadas.map((j) => (
                        <TableRow key={j.id}>
                          <TableCell>{DIAS_SEMANA_LABEL[j.diaSemana] ?? j.diaSemana}</TableCell>
                          <TableCell className="font-mono text-sm">{j.horaInicio.slice(11, 16)}</TableCell>
                          <TableCell className="font-mono text-sm">{j.horaFin.slice(11, 16)}</TableCell>
                          {canManage ? (
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={jornadaDeleteM.isPending}
                                onClick={() => jornadaDeleteM.mutate({ id: j.id })}
                              >
                                Quitar
                              </Button>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {canManage && contrato.estado !== "TERMINADO" ? (
                  <div className="flex items-end gap-2">
                    <Select
                      value={nuevaJornada.diaSemana}
                      onValueChange={(v) => setNuevaJornada((p) => ({ ...p, diaSemana: v }))}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(DIAS_SEMANA_LABEL).map(([v, label]) => (
                          <SelectItem key={v} value={v}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="time"
                      value={nuevaJornada.horaInicio}
                      onChange={(e) => setNuevaJornada((p) => ({ ...p, horaInicio: e.target.value }))}
                    />
                    <Input
                      type="time"
                      value={nuevaJornada.horaFin}
                      onChange={(e) => setNuevaJornada((p) => ({ ...p, horaFin: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={jornadaCreateM.isPending}
                      onClick={() =>
                        jornadaCreateM.mutate({
                          contratoId: contrato.id,
                          diaSemana: Number(nuevaJornada.diaSemana),
                          horaInicio: nuevaJornada.horaInicio,
                          horaFin: nuevaJornada.horaFin,
                        })
                      }
                    >
                      + Jornada
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Cargos devengados</Label>
                {canManage && (contrato.estado === "VIGENTE" || contrato.estado === "EN_MORA") ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      className="w-40"
                      value={periodoGenerar}
                      onChange={(e) => setPeriodoGenerar(e.target.value)}
                      placeholder="YYYY-MM-01"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cargoGenerarM.isPending || !periodoGenerar}
                      onClick={() =>
                        cargoGenerarM.mutate({ contratoId: contrato.id, periodo: periodoGenerar })
                      }
                    >
                      Generar período
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Período</TableHead>
                      <TableHead>Concepto</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Estado</TableHead>
                      {canManage ? <TableHead className="text-right">Acciones</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(cargos.data ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          Sin cargos devengados todavía.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {(
                      (cargos.data ?? []) as Array<{
                        id: string;
                        periodo: string;
                        concepto: string;
                        monto: string | number;
                        estado: string;
                      }>
                    ).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-sm">{c.periodo.slice(0, 10)}</TableCell>
                        <TableCell>{c.concepto}</TableCell>
                        <TableCell>{String(c.monto)}</TableCell>
                        <TableCell>
                          <Badge variant={c.estado === "DEVENGADO" ? "success" : "outline"}>{c.estado}</Badge>
                        </TableCell>
                        {canManage ? (
                          <TableCell className="text-right">
                            {c.estado === "DEVENGADO" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={cargoAnularM.isPending}
                                onClick={() => cargoAnularM.mutate({ id: c.id, motivo: "Anulado desde admin" })}
                              >
                                Anular
                              </Button>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
