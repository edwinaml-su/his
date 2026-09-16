"use client";

/**
 * Detalle de cita ambulatoria — CC-0036 Ola 4 (REQ-HIS-AFIL-001 S4,
 * US.AGE.2.4-2.7). Extiende el módulo legacy §10 Consulta Externa
 * (`/outpatient`) — cierra además el link "Ver" del listado, que hasta
 * ahora apuntaba a una ruta inexistente.
 *
 * Formularios inline (no modal) por accesibilidad de teclado en recepción —
 * mismo criterio NFR-8 del REQ. Reprogramar pide `agendaId`+fecha/hora en
 * vez de una grilla visual de disponibilidad (fuera de alcance del tiempo de
 * esta ola; el servidor sigue validando contra `fn_agenda_disponibilidad`).
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
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
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";
import { StatusBadge, type AppointmentStatus } from "../_components/status-badge";

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" });

const MOTIVO_CANCELACION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "PACIENTE_NO_PUEDE", label: "El paciente no puede asistir" },
  { value: "MEDICO_NO_DISPONIBLE", label: "El médico no está disponible" },
  { value: "ERROR_AGENDAMIENTO", label: "Error de agendamiento" },
  { value: "DUPLICADO", label: "Cita duplicada" },
  { value: "OTRO", label: "Otro" },
];

export default function OutpatientAppointmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [showCancelar, setShowCancelar] = React.useState(false);
  const [showReprogramar, setShowReprogramar] = React.useState(false);
  const [showRevertir, setShowRevertir] = React.useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = React.useState("PACIENTE_NO_PUEDE");
  const [notasCancelacion, setNotasCancelacion] = React.useState("");
  const [reprogramarAgendaId, setReprogramarAgendaId] = React.useState("");
  const [reprogramarFecha, setReprogramarFecha] = React.useState("");
  const [reprogramarMotivo, setReprogramarMotivo] = React.useState("");
  const [motivoRevertir, setMotivoRevertir] = React.useState("");

  const query = trpc.outpatient.appointment.get.useQuery({ id });
  const chainQuery = trpc.outpatient.appointment.reprogramacionChain.useQuery({ id }, { enabled: !!query.data });

  function refetchAll() {
    query.refetch();
    chainQuery.refetch();
  }
  function onErr(err: { message: string }) {
    setErrorMsg(err.message);
  }

  const checkInM = trpc.outpatient.appointment.checkIn.useMutation({ onSuccess: refetchAll, onError: onErr });
  const cancelarM = trpc.outpatient.appointment.cancelar.useMutation({
    onSuccess: () => {
      setShowCancelar(false);
      refetchAll();
    },
    onError: onErr,
  });
  const reprogramarM = trpc.outpatient.appointment.reprogramar.useMutation({
    onSuccess: (result) => {
      setShowReprogramar(false);
      router.push(`/outpatient/${result.nueva.id}`);
    },
    onError: onErr,
  });
  const revertirM = trpc.outpatient.appointment.revertirNoShow.useMutation({
    onSuccess: () => {
      setShowRevertir(false);
      refetchAll();
    },
    onError: onErr,
  });
  const completarM = trpc.outpatient.appointment.completar.useMutation({ onSuccess: refetchAll, onError: onErr });
  const iniciarAtencionM = trpc.outpatient.appointment.iniciarAtencion.useMutation({
    onSuccess: refetchAll,
    onError: onErr,
  });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (query.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>No se pudo cargar la cita</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
      </Alert>
    );
  }
  const cita = query.data;
  if (!cita) return null;

  const status = cita.status as AppointmentStatus;
  const patientName = cita.patient ? `${cita.patient.firstName} ${cita.patient.lastName}` : "—";
  const providerName = cita.provider?.fullName ?? "—";
  const puedeReprogramarCancelar = status === "SCHEDULED" || status === "CONFIRMED";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Cita ambulatoria</h1>
          <p className="text-sm text-muted-foreground">{dateFmt.format(new Date(cita.scheduledAt))}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/outpatient">Volver al listado</Link>
        </Button>
      </div>

      {errorMsg && (
        <Alert variant="destructive">
          <AlertTitle>No se pudo completar la acción</AlertTitle>
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {patientName}
            <StatusBadge status={status} />
            {cita.esSobrecupo && (
              <span className="rounded-md bg-warning px-2 py-0.5 text-xs font-medium text-warning-foreground">
                Sobrecupo
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Expediente (MRN)" value={cita.patient?.mrn ?? "—"} />
          <Field label="Médico" value={providerName} />
          <Field label="Duración" value={`${cita.durationMinutes} min`} />
          <Field label="Motivo" value={cita.reason ?? "—"} />
          <Field label="Tipo de cita" value={cita.tipoCita ?? "—"} />
          <Field label="Canal" value={cita.canal ?? "—"} />
          {cita.llegadaAt && <Field label="Llegada" value={dateFmt.format(new Date(cita.llegadaAt))} />}
          {cita.inicioAtencionAt && <Field label="Inicio de atención" value={dateFmt.format(new Date(cita.inicioAtencionAt))} />}
          {cita.finAtencionAt && <Field label="Fin de atención" value={dateFmt.format(new Date(cita.finAtencionAt))} />}
          {cita.motivoCancelacion && <Field label="Motivo de cancelación" value={cita.motivoCancelacion} />}
        </CardContent>
      </Card>

      {chainQuery.data && chainQuery.data.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Cadena de reprogramaciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {chainQuery.data.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span>
                  {dateFmt.format(new Date(c.scheduledAt))} — <StatusBadge status={c.status as AppointmentStatus} />
                </span>
                {c.id !== id && (
                  <Link href={`/outpatient/${c.id}`} className="text-primary underline underline-offset-2">
                    Ver
                  </Link>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Acciones</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(status === "SCHEDULED" || status === "CONFIRMED") && (
            <Button onClick={() => checkInM.mutate({ id })} disabled={checkInM.isPending} aria-label="Registrar check-in">
              {checkInM.isPending ? "Registrando…" : "Check-in"}
            </Button>
          )}
          {puedeReprogramarCancelar && (
            <Button variant="outline" onClick={() => setShowReprogramar((v) => !v)} aria-expanded={showReprogramar}>
              Reprogramar
            </Button>
          )}
          {puedeReprogramarCancelar && (
            <Button variant="outline" onClick={() => setShowCancelar((v) => !v)} aria-expanded={showCancelar}>
              Cancelar
            </Button>
          )}
          {status === "NO_SHOW" && (
            <Button variant="outline" onClick={() => setShowRevertir((v) => !v)} aria-expanded={showRevertir}>
              Revertir no-show (llegó tarde)
            </Button>
          )}
          {status === "CHECKED_IN" && (
            <>
              <Button
                variant="outline"
                onClick={() => iniciarAtencionM.mutate({ id })}
                disabled={iniciarAtencionM.isPending || !!cita.inicioAtencionAt}
              >
                {cita.inicioAtencionAt ? "En atención" : "Iniciar atención"}
              </Button>
              <Button onClick={() => completarM.mutate({ id })} disabled={completarM.isPending}>
                {completarM.isPending ? "Completando…" : "Completar atención"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {showCancelar && (
        <Card>
          <CardHeader>
            <CardTitle>Cancelar cita</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="motivo-cancelacion">Motivo</Label>
              <Select value={motivoCancelacion} onValueChange={setMotivoCancelacion}>
                <SelectTrigger id="motivo-cancelacion">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVO_CANCELACION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notas-cancelacion">Notas (opcional)</Label>
              <Textarea id="notas-cancelacion" value={notasCancelacion} onChange={(e) => setNotasCancelacion(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCancelar(false)}>
                Cerrar
              </Button>
              <Button
                variant="destructive"
                disabled={cancelarM.isPending}
                onClick={() =>
                  cancelarM.mutate({
                    id,
                    motivo: motivoCancelacion as never,
                    notas: notasCancelacion.trim() || undefined,
                  })
                }
              >
                {cancelarM.isPending ? "Cancelando…" : "Confirmar cancelación"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showReprogramar && (
        <Card>
          <CardHeader>
            <CardTitle>Reprogramar cita</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reprogramar-agenda">Agenda (ID)</Label>
                <Input
                  id="reprogramar-agenda"
                  placeholder={cita.agendaId ?? "UUID de la agenda"}
                  value={reprogramarAgendaId}
                  onChange={(e) => setReprogramarAgendaId(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reprogramar-fecha">Nueva fecha y hora</Label>
                <Input
                  id="reprogramar-fecha"
                  type="datetime-local"
                  value={reprogramarFecha}
                  onChange={(e) => setReprogramarFecha(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reprogramar-motivo">Motivo (opcional)</Label>
              <Input id="reprogramar-motivo" value={reprogramarMotivo} onChange={(e) => setReprogramarMotivo(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowReprogramar(false)}>
                Cerrar
              </Button>
              <Button
                disabled={reprogramarM.isPending || !reprogramarAgendaId.trim() || !reprogramarFecha}
                onClick={() =>
                  reprogramarM.mutate({
                    id,
                    agendaId: (reprogramarAgendaId.trim() || cita.agendaId) as string,
                    slotInicio: new Date(reprogramarFecha),
                    motivo: reprogramarMotivo.trim() || undefined,
                  })
                }
              >
                {reprogramarM.isPending ? "Reprogramando…" : "Confirmar reprogramación"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showRevertir && (
        <Card>
          <CardHeader>
            <CardTitle>Revertir no-show</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="motivo-revertir">Motivo</Label>
              <Textarea id="motivo-revertir" value={motivoRevertir} onChange={(e) => setMotivoRevertir(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowRevertir(false)}>
                Cerrar
              </Button>
              <Button
                disabled={revertirM.isPending || !motivoRevertir.trim()}
                onClick={() => revertirM.mutate({ id, motivo: motivoRevertir.trim() })}
              >
                {revertirM.isPending ? "Guardando…" : "Confirmar llegada"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
