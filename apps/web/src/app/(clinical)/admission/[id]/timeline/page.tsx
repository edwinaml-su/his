"use client";

/**
 * /admission/[id]/timeline — Stepper de los 3 hitos del ciclo hospitalario ISSS.
 *
 * Hito 1: Decisión clínica → status=ADMISSION_DECIDED
 * Hito 2: Asignación cama  → status=BED_ASSIGNED
 * Hito 3: Recepción física → status=ACTIVE (INICIA DÍA-CAMA, Norma 6 ISSS)
 *
 * Spec: docs/36_admision_vs_ingreso_isss.md
 */
import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Stethoscope,
  Bed as BedIcon,
  UserCheck,
  XCircle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

type Status =
  | "ADMISSION_DECIDED"
  | "BED_ASSIGNED"
  | "ACTIVE"
  | "DISCHARGE_PENDING"
  | "ON_LEAVE"
  | "CANCELLED"
  | "DISCHARGED"
  | "TRANSFERRED_OUT";

interface AdmissionRow {
  id: string;
  status: Status;
  reason: string;
  notes: string | null;
  admissionDecidedAt: string | Date | null;
  admissionDecidedById: string | null;
  bedAssignedAt: string | Date | null;
  bedAssignedById: string | null;
  bedId: string | null;
  physicalAdmittedAt: string | Date | null;
  physicalAdmittedById: string | null;
  wristbandPlacedAt: string | Date | null;
  admissionFormNumber: string | null;
  admittedAt: string | Date;
  dischargedAt: string | Date | null;
  patient: { id: string; firstName: string; lastName: string; mrn: string } | null;
  attending: { id: string; fullName: string } | null;
}

function fmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-SV", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function diffMin(a: string | Date | null | undefined, b: string | Date | null | undefined): string {
  if (!a || !b) return "—";
  const min = Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / 60_000,
  );
  if (min < 0) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface StepProps {
  num: number;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  done: boolean;
  current: boolean;
  timestamp: string | Date | null;
  byUser?: string | null;
  children?: React.ReactNode;
}

function Step({ num, title, description, icon: Icon, done, current, timestamp, byUser, children }: StepProps) {
  return (
    <li className="relative pl-10">
      <span
        className={`absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
          done
            ? "border-emerald-500 bg-emerald-500 text-white"
            : current
              ? "border-blue-500 bg-blue-500 text-white animate-pulse"
              : "border-muted-foreground/30 bg-background text-muted-foreground"
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <div className="space-y-1 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`text-base font-semibold ${done ? "" : current ? "text-blue-700" : "text-muted-foreground"}`}>
            Hito {num} — {title}
          </h3>
          {done && (
            <Badge variant="success" className="text-[10px]">Completado</Badge>
          )}
          {current && !done && (
            <Badge className="bg-blue-500 text-white text-[10px]">Actual</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {timestamp && (
          <p className="text-xs">
            <Clock className="mr-1 inline h-3 w-3" />
            {fmt(timestamp)}
            {byUser && <span className="ml-2 text-muted-foreground">· por {byUser.slice(0, 8)}…</span>}
          </p>
        )}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

export default function AdmissionTimelinePage() {
  const { id } = useParams<{ id: string }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const listQuery = trpcAny.inpatient.admission.list.useQuery({ limit: 200 });
  const adm = (listQuery.data ?? []).find((a: AdmissionRow) => a.id === id) as
    | AdmissionRow
    | undefined;

  // Inputs para los procedures
  const [bedIdInput, setBedIdInput] = React.useState("");
  const [formNumberInput, setFormNumberInput] = React.useState("");
  const [cancelReason, setCancelReason] = React.useState("");

  const utils = trpcAny.useUtils?.() ?? trpcAny.useContext?.();
  const refetch = () => {
    if (utils?.inpatient?.admission?.list?.invalidate) {
      utils.inpatient.admission.list.invalidate();
    } else {
      listQuery.refetch();
    }
  };

  const asignarMut = trpcAny.inpatient.admission.asignarCama.useMutation({
    onSuccess: refetch,
  });
  const recibirMut = trpcAny.inpatient.admission.confirmarRecepcionFisica.useMutation({
    onSuccess: refetch,
  });
  const cancelarMut = trpcAny.inpatient.admission.cancelarPreCama.useMutation({
    onSuccess: refetch,
  });

  if (listQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!adm) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">Admisión no encontrada en esta organización.</p>
        <Button asChild variant="outline">
          <Link href="/admission">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Volver
          </Link>
        </Button>
      </div>
    );
  }

  const hito1Done = !!adm.admissionDecidedAt;
  const hito2Done = !!adm.bedAssignedAt;
  const hito3Done = !!adm.physicalAdmittedAt;
  const cancelled = adm.status === "CANCELLED";

  let current: 1 | 2 | 3 | 4 = 1;
  if (hito3Done) current = 4;
  else if (hito2Done) current = 3;
  else if (hito1Done) current = 2;

  const patientLabel = adm.patient
    ? `${adm.patient.firstName} ${adm.patient.lastName} · ${adm.patient.mrn}`
    : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admission">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Volver
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Ciclo de hospitalización</h1>
          <p className="text-sm text-muted-foreground">
            {patientLabel} · Estado: <strong>{adm.status}</strong>
          </p>
        </div>
      </div>

      {cancelled && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <XCircle className="h-6 w-6 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">Admisión cancelada</p>
              <p className="text-xs text-muted-foreground">
                Esta admisión fue cancelada antes de la asignación de cama (no consumió recursos hospitalarios).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Hitos según ISSS MNP-S-138 (Norma General 6 para día-cama)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-0">
            <Step
              num={1}
              title="Admisión (decisión clínica)"
              description="El médico tratante indica el ingreso del paciente. Aún no consume recursos."
              icon={Stethoscope}
              done={hito1Done}
              current={current === 1}
              timestamp={adm.admissionDecidedAt}
              byUser={adm.admissionDecidedById}
            >
              {!cancelled && hito1Done && !hito2Done && (
                <div className="mt-2 space-y-2 rounded-md border bg-amber-50 p-3 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold uppercase text-amber-900 dark:text-amber-200">
                    Cancelar admisión pre-cama
                  </p>
                  <Input
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Motivo de cancelación (obligatorio)"
                    className="text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cancelarMut.isPending || cancelReason.trim().length < 3}
                    onClick={() => cancelarMut.mutate({ id: adm.id, reason: cancelReason })}
                  >
                    {cancelarMut.isPending ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <XCircle className="mr-1 h-3 w-3" />
                    )}
                    Cancelar
                  </Button>
                </div>
              )}
            </Step>

            <Step
              num={2}
              title="Asignación de cama"
              description="Reserva operativa de una cama física. La cama queda 'reservada' pero no 'ocupada' hasta el Hito 3."
              icon={BedIcon}
              done={hito2Done}
              current={current === 2}
              timestamp={adm.bedAssignedAt}
              byUser={adm.bedAssignedById}
            >
              {!cancelled && hito1Done && !hito2Done && (
                <div className="mt-2 space-y-2 rounded-md border bg-blue-50 p-3 dark:bg-blue-950/30">
                  <Label htmlFor="bedId" className="text-xs">ID de cama a asignar</Label>
                  <Input
                    id="bedId"
                    value={bedIdInput}
                    onChange={(e) => setBedIdInput(e.target.value)}
                    placeholder="UUID de la cama (ver /beds)"
                    className="font-mono text-xs"
                  />
                  {asignarMut.error && (
                    <p className="text-xs text-destructive">
                      {(asignarMut.error as { message?: string }).message}
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={asignarMut.isPending || bedIdInput.length !== 36}
                    onClick={() => asignarMut.mutate({ id: adm.id, bedId: bedIdInput })}
                  >
                    {asignarMut.isPending ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <BedIcon className="mr-1 h-3 w-3" />
                    )}
                    Asignar cama
                  </Button>
                </div>
              )}
              {hito1Done && hito2Done && adm.bedId && (
                <p className="text-xs font-mono text-muted-foreground">
                  bedId: {adm.bedId.slice(0, 8)}…
                </p>
              )}
            </Step>

            <Step
              num={3}
              title="Recepción física (INICIA DÍA-CAMA)"
              description="Paciente recibido en sala, identificado con brazalete GSRN, Hoja SAFISSS 130201132 firmada. Norma General 6 ISSS."
              icon={UserCheck}
              done={hito3Done}
              current={current === 3}
              timestamp={adm.physicalAdmittedAt}
              byUser={adm.physicalAdmittedById}
            >
              {!cancelled && hito2Done && !hito3Done && (
                <div className="mt-2 space-y-2 rounded-md border bg-emerald-50 p-3 dark:bg-emerald-950/30">
                  <Label htmlFor="formNum" className="text-xs">
                    N° Hoja SAFISSS 130201132 (opcional)
                  </Label>
                  <Input
                    id="formNum"
                    value={formNumberInput}
                    onChange={(e) => setFormNumberInput(e.target.value)}
                    placeholder="Ej: H-2026-00123"
                    className="text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Al confirmar, la cama pasa a estado OCCUPIED y se coloca pulsera GSRN.
                  </p>
                  {recibirMut.error && (
                    <p className="text-xs text-destructive">
                      {(recibirMut.error as { message?: string }).message}
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={recibirMut.isPending}
                    onClick={() =>
                      recibirMut.mutate({
                        id: adm.id,
                        admissionFormNumber: formNumberInput || undefined,
                        wristbandPlaced: true,
                      })
                    }
                  >
                    {recibirMut.isPending ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <UserCheck className="mr-1 h-3 w-3" />
                    )}
                    Confirmar recepción
                  </Button>
                </div>
              )}
              {hito3Done && adm.admissionFormNumber && (
                <p className="text-xs">
                  Hoja N°: <span className="font-mono">{adm.admissionFormNumber}</span>
                </p>
              )}
            </Step>
          </ol>

          {/* Resumen de tiempos */}
          {(hito2Done || hito3Done) && (
            <div className="mt-4 grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Decisión → Cama</p>
                <p className="text-sm font-semibold">
                  {diffMin(adm.admissionDecidedAt, adm.bedAssignedAt)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Cama → Recepción</p>
                <p className="text-sm font-semibold">
                  {diffMin(adm.bedAssignedAt, adm.physicalAdmittedAt)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Día-cama (Norma 6)</p>
                <p className="text-sm font-semibold">
                  {adm.dischargedAt
                    ? diffMin(adm.physicalAdmittedAt, adm.dischargedAt)
                    : adm.physicalAdmittedAt
                      ? "En curso"
                      : "—"}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos de la admisión</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-semibold">Motivo:</span> {adm.reason}
          </p>
          {adm.notes && (
            <p className="whitespace-pre-wrap">
              <span className="font-semibold">Notas:</span> {adm.notes}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
