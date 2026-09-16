"use client";

/**
 * Detalle de agenda — CC-0036 Ola 3 (REQ-HIS-AFIL-001 US.AGE.2.1/2.2/2.3).
 * Tabs: horarios (US.AGE.2.1), excepciones (US.AGE.2.2, con confirmación
 * explícita de citas afectadas) y disponibilidad derivada (US.AGE.2.3,
 * grilla agrupada por fecha). Transiciones publicar/suspender/reactivar con
 * confirmación inline, mismo patrón que `/contratos`.
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
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
  PUBLICADA: "success",
  SUSPENDIDA: "warning",
  CERRADA: "destructive",
};

const EXCEPCION_TIPOS = ["BLOQUEO", "EXTENSION", "VACACION", "CONGRESO"] as const;

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function masDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

type Props = {
  agendaId: string | null;
  onOpenChange: (open: boolean) => void;
  canConfigure: boolean;
  onChanged: () => void;
};

export function AgendaDetailDialog({ agendaId, onOpenChange, canConfigure, onChanged }: Props) {
  const open = agendaId !== null;
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [confirmando, setConfirmando] = React.useState<"suspender" | null>(null);
  const [motivoSuspender, setMotivoSuspender] = React.useState("");

  const [nuevoHorario, setNuevoHorario] = React.useState({ diaSemana: "1", horaInicio: "08:00", horaFin: "12:00" });
  const [nuevaExcepcion, setNuevaExcepcion] = React.useState({
    fecha: "",
    tipo: "BLOQUEO" as (typeof EXCEPCION_TIPOS)[number],
    horaInicio: "",
    horaFin: "",
    motivo: "",
  });
  const [citasAfectadas, setCitasAfectadas] = React.useState<Array<{ id: string; scheduledAt: string }> | null>(
    null,
  );

  const [dispDesde, setDispDesde] = React.useState(hoy());
  const [dispHasta, setDispHasta] = React.useState(masDias(14));

  React.useEffect(() => {
    if (!open) {
      setErrorMsg(null);
      setConfirmando(null);
      setMotivoSuspender("");
      setCitasAfectadas(null);
    }
  }, [open]);

  const query = trpcAny.agenda.get.useQuery({ id: agendaId }, { enabled: open });
  const horariosQuery = trpcAny.agenda.horario.list.useQuery({ agendaId }, { enabled: open });
  const excepcionesQuery = trpcAny.agenda.excepcion.list.useQuery({ agendaId }, { enabled: open });
  const disponibilidadQuery = trpcAny.agenda.disponibilidad.useQuery(
    { agendaId, desde: dispDesde, hasta: dispHasta },
    { enabled: open },
  );

  function refetchAll() {
    query.refetch();
    horariosQuery.refetch();
    excepcionesQuery.refetch();
    disponibilidadQuery.refetch();
    onChanged();
  }

  const onErr = (err: { message: string; data?: { causas?: unknown } }) => {
    const causas = err.data?.causas as Array<{ id: string; scheduledAt: string }> | undefined;
    if (causas) {
      setCitasAfectadas(causas);
    }
    setErrorMsg(err.message);
  };

  const publicarM = trpcAny.agenda.publicar.useMutation({ onSuccess: refetchAll, onError: onErr });
  const suspenderM = trpcAny.agenda.suspender.useMutation({
    onSuccess: () => {
      setConfirmando(null);
      refetchAll();
    },
    onError: onErr,
  });
  const reactivarM = trpcAny.agenda.reactivar.useMutation({ onSuccess: refetchAll, onError: onErr });
  const horarioCreateM = trpcAny.agenda.horario.create.useMutation({ onSuccess: refetchAll, onError: onErr });
  const horarioDeleteM = trpcAny.agenda.horario.delete.useMutation({ onSuccess: refetchAll, onError: onErr });
  const excepcionCreateM = trpcAny.agenda.excepcion.create.useMutation({
    onSuccess: () => {
      setNuevaExcepcion({ fecha: "", tipo: "BLOQUEO", horaInicio: "", horaFin: "", motivo: "" });
      setCitasAfectadas(null);
      refetchAll();
    },
    onError: onErr,
  });
  const excepcionDeleteM = trpcAny.agenda.excepcion.delete.useMutation({ onSuccess: refetchAll, onError: onErr });

  const agenda = query.data as
    | {
        id: string;
        estado: string;
        estadoEfectivo: string;
        duracionSlotMin: number;
        capacidadPorSlot: number;
        medicoAfiliado: { nombreCompleto: string; jvpmNumero: string };
        consultorio: { codigo: string; nombre: string };
        contrato: { estado: string; modalidad: string } | null;
      }
    | undefined;

  function submitExcepcion(forzar: boolean) {
    if (!agendaId) return;
    setErrorMsg(null);
    excepcionCreateM.mutate({
      agendaId,
      fecha: nuevaExcepcion.fecha,
      tipo: nuevaExcepcion.tipo,
      horaInicio: nuevaExcepcion.horaInicio || undefined,
      horaFin: nuevaExcepcion.horaFin || undefined,
      motivo: nuevaExcepcion.motivo,
      forzar,
    });
  }

  const slotsPorFecha = React.useMemo(() => {
    const grupos: Record<string, Array<{ inicio: string; fin: string; disponible: number; ocupados: number }>> = {};
    for (const agendaResult of (disponibilidadQuery.data ?? []) as Array<{
      slots: Array<{ inicio: string; fin: string; disponible: number; ocupados: number }>;
    }>) {
      for (const s of agendaResult.slots) {
        const fecha = s.inicio.slice(0, 10);
        (grupos[fecha] ??= []).push(s);
      }
    }
    return grupos;
  }, [disponibilidadQuery.data]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onOpenChange(false)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{agenda ? `Agenda — ${agenda.medicoAfiliado.nombreCompleto}` : "Agenda"}</DialogTitle>
          <DialogDescription>
            {agenda ? `${agenda.consultorio.codigo} — ${agenda.consultorio.nombre}` : "Cargando…"}
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{errorMsg}</p>
              {citasAfectadas && citasAfectadas.length > 0 ? (
                <ul className="list-disc pl-5 text-xs">
                  {citasAfectadas.map((c) => (
                    <li key={c.id}>{new Date(c.scheduledAt).toLocaleString("es-SV")}</li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        )}

        {agenda ? (
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant={ESTADO_BADGE[agenda.estadoEfectivo] ?? "outline"}>{agenda.estadoEfectivo}</Badge>
              {agenda.estadoEfectivo !== agenda.estado ? (
                <span className="text-xs text-muted-foreground">
                  (persistido: {agenda.estado} — suspendida por mora del contrato asociado)
                </span>
              ) : null}
              <span className="text-muted-foreground">
                Slot: {agenda.duracionSlotMin} min · Capacidad: {agenda.capacidadPorSlot}
              </span>
            </div>

            {canConfigure ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap gap-2">
                  {agenda.estado === "BORRADOR" ? (
                    <Button size="sm" disabled={publicarM.isPending} onClick={() => publicarM.mutate({ id: agenda.id })}>
                      {publicarM.isPending ? "Publicando…" : "Publicar"}
                    </Button>
                  ) : null}
                  {agenda.estado !== "SUSPENDIDA" && agenda.estado !== "CERRADA" ? (
                    <Button size="sm" variant="outline" onClick={() => setConfirmando("suspender")}>
                      Suspender
                    </Button>
                  ) : null}
                  {agenda.estado === "SUSPENDIDA" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reactivarM.isPending}
                      onClick={() => reactivarM.mutate({ id: agenda.id })}
                    >
                      {reactivarM.isPending ? "Reactivando…" : "Reactivar"}
                    </Button>
                  ) : null}
                </div>

                {confirmando === "suspender" ? (
                  <Alert>
                    <AlertTitle>Suspender agenda</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <div className="space-y-1">
                        <Label htmlFor="susp-motivo">Motivo</Label>
                        <Input
                          id="susp-motivo"
                          value={motivoSuspender}
                          onChange={(e) => setMotivoSuspender(e.target.value)}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={suspenderM.isPending || !motivoSuspender.trim()}
                          onClick={() => suspenderM.mutate({ id: agenda.id, motivo: motivoSuspender.trim() })}
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

            <Tabs defaultValue="horarios">
              <TabsList>
                <TabsTrigger value="horarios">Horarios</TabsTrigger>
                <TabsTrigger value="excepciones">Excepciones</TabsTrigger>
                <TabsTrigger value="disponibilidad">Disponibilidad</TabsTrigger>
              </TabsList>

              <TabsContent value="horarios" className="space-y-2">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Día</TableHead>
                        <TableHead>Inicio</TableHead>
                        <TableHead>Fin</TableHead>
                        {canConfigure ? <TableHead className="text-right">Acciones</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((horariosQuery.data ?? []) as Array<{
                        id: string;
                        diaSemana: number;
                        horaInicio: string;
                        horaFin: string;
                      }>).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                            Sin horarios registrados.
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {((horariosQuery.data ?? []) as Array<{
                        id: string;
                        diaSemana: number;
                        horaInicio: string;
                        horaFin: string;
                      }>).map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>{DIAS_SEMANA_LABEL[h.diaSemana] ?? h.diaSemana}</TableCell>
                          <TableCell className="font-mono text-sm">{h.horaInicio.slice(11, 16)}</TableCell>
                          <TableCell className="font-mono text-sm">{h.horaFin.slice(11, 16)}</TableCell>
                          {canConfigure ? (
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={horarioDeleteM.isPending}
                                onClick={() => horarioDeleteM.mutate({ id: h.id })}
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
                {canConfigure ? (
                  <div className="flex items-end gap-2">
                    <Select
                      value={nuevoHorario.diaSemana}
                      onValueChange={(v) => setNuevoHorario((p) => ({ ...p, diaSemana: v }))}
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
                      value={nuevoHorario.horaInicio}
                      onChange={(e) => setNuevoHorario((p) => ({ ...p, horaInicio: e.target.value }))}
                    />
                    <Input
                      type="time"
                      value={nuevoHorario.horaFin}
                      onChange={(e) => setNuevoHorario((p) => ({ ...p, horaFin: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={horarioCreateM.isPending}
                      onClick={() => {
                        setErrorMsg(null);
                        horarioCreateM.mutate({
                          agendaId: agenda.id,
                          diaSemana: Number(nuevoHorario.diaSemana),
                          horaInicio: nuevoHorario.horaInicio,
                          horaFin: nuevoHorario.horaFin,
                        });
                      }}
                    >
                      + Horario
                    </Button>
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="excepciones" className="space-y-2">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Horario</TableHead>
                        <TableHead>Motivo</TableHead>
                        {canConfigure ? <TableHead className="text-right">Acciones</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((excepcionesQuery.data ?? []) as Array<{
                        id: string;
                        fecha: string;
                        tipo: string;
                        horaInicio: string | null;
                        horaFin: string | null;
                        motivo: string;
                      }>).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                            Sin excepciones registradas.
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {((excepcionesQuery.data ?? []) as Array<{
                        id: string;
                        fecha: string;
                        tipo: string;
                        horaInicio: string | null;
                        horaFin: string | null;
                        motivo: string;
                      }>).map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-mono text-sm">{e.fecha.slice(0, 10)}</TableCell>
                          <TableCell>
                            <Badge variant={e.tipo === "EXTENSION" ? "success" : "outline"}>{e.tipo}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {e.horaInicio ? `${e.horaInicio.slice(11, 16)}–${e.horaFin!.slice(11, 16)}` : "Día completo"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.motivo}</TableCell>
                          {canConfigure ? (
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={excepcionDeleteM.isPending}
                                onClick={() => excepcionDeleteM.mutate({ id: e.id })}
                              >
                                Eliminar
                              </Button>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {canConfigure ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="grid grid-cols-4 gap-2">
                      <Input
                        type="date"
                        value={nuevaExcepcion.fecha}
                        onChange={(e) => setNuevaExcepcion((p) => ({ ...p, fecha: e.target.value }))}
                      />
                      <Select
                        value={nuevaExcepcion.tipo}
                        onValueChange={(v) =>
                          setNuevaExcepcion((p) => ({ ...p, tipo: v as (typeof EXCEPCION_TIPOS)[number] }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXCEPCION_TIPOS.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="time"
                        placeholder="Inicio (opcional = día completo)"
                        value={nuevaExcepcion.horaInicio}
                        onChange={(e) => setNuevaExcepcion((p) => ({ ...p, horaInicio: e.target.value }))}
                      />
                      <Input
                        type="time"
                        placeholder="Fin"
                        value={nuevaExcepcion.horaFin}
                        onChange={(e) => setNuevaExcepcion((p) => ({ ...p, horaFin: e.target.value }))}
                      />
                    </div>
                    <Input
                      placeholder="Motivo"
                      value={nuevaExcepcion.motivo}
                      onChange={(e) => setNuevaExcepcion((p) => ({ ...p, motivo: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={excepcionCreateM.isPending || !nuevaExcepcion.fecha || !nuevaExcepcion.motivo.trim()}
                        onClick={() => submitExcepcion(false)}
                      >
                        + Excepción
                      </Button>
                      {citasAfectadas && citasAfectadas.length > 0 ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={excepcionCreateM.isPending}
                          onClick={() => submitExcepcion(true)}
                        >
                          Confirmar pese a citas afectadas
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="disponibilidad" className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="disp-desde">Desde</Label>
                    <Input id="disp-desde" type="date" value={dispDesde} onChange={(e) => setDispDesde(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="disp-hasta">Hasta</Label>
                    <Input id="disp-hasta" type="date" value={dispHasta} onChange={(e) => setDispHasta(e.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => disponibilidadQuery.refetch()}>
                    Consultar
                  </Button>
                </div>

                {((disponibilidadQuery.data ?? []) as Array<{ advertencias: string[] }>).flatMap(
                  (r) => r.advertencias,
                ).length > 0 ? (
                  <Alert>
                    <AlertTitle>Advertencia</AlertTitle>
                    <AlertDescription>
                      {(disponibilidadQuery.data as Array<{ advertencias: string[] }>)
                        .flatMap((r) => r.advertencias)
                        .join(" ")}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {Object.keys(slotsPorFecha).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin cupos en el rango consultado.</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(slotsPorFecha)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([fecha, slots]) => (
                        <div key={fecha} className="space-y-1">
                          <p className="text-sm font-medium">{fecha}</p>
                          <div className="flex flex-wrap gap-1">
                            {slots.map((s, i) => (
                              <Badge
                                key={i}
                                variant={s.disponible > 0 ? "success" : "outline"}
                                className="font-mono text-xs"
                                title={`Ocupados: ${s.ocupados}`}
                              >
                                {s.inicio.slice(11, 16)}–{s.fin.slice(11, 16)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
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
