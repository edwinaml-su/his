"use client";

/**
 * Wizard Hoja de Ingreso — Admisión desde Orden de Ingreso.
 *
 * Paso 1: Seleccionar orden de ingreso pendiente (lista de ADM).
 *   - Carga listOrdenesPendientesAdmision.
 *   - Al seleccionar una orden, auto-rellena datos del paciente y la orden.
 * Paso 2: Detalles de admisión (cama, modalidad, procedencia, fecha/hora).
 * Paso 3: Confirmar + PIN ADM → llama admitirDesdeOrden.
 * Resultado: feedback de qué se creó (episodio / hoja ingreso / cama).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardList, BedDouble, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ── tipos locales ─────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | "success";

interface OrdenSeleccionada {
  id: string;
  pacienteId: string;
  pacienteNombre: string;
  servicioNombre: string | null;
  modalidad: string;
  procedencia: string;
  circunstanciaIngreso: string;
  fechaHoraOrden: string;
}

interface AdmisionResult {
  episodioId: string;
  episodioHospitalarioId: string;
  hojaIngresoId: string;
  camaAsignadaId: string | null;
}

// ── step indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { num: 1 as Step, label: "Orden de ingreso" },
  { num: 2 as Step, label: "Datos de admisión" },
  { num: 3 as Step, label: "Confirmar y firmar" },
];

function StepIndicator({ current }: { current: Step }) {
  return (
    <nav aria-label="Pasos de admisión" className="mb-6">
      <ol className="flex items-center gap-0">
        {STEPS.map((s, idx) => {
          const stepNum = s.num as number;
          const currentNum = typeof current === "number" ? current : 4;
          const done = currentNum > stepNum;
          const active = currentNum === stepNum;
          return (
            <React.Fragment key={s.num}>
              <li className="flex flex-col items-center gap-1">
                <span
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold",
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : active
                        ? "border-primary bg-background text-primary"
                        : "border-muted-foreground/30 bg-background text-muted-foreground",
                  ].join(" ")}
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : s.num}
                </span>
                <span
                  className={[
                    "text-xs",
                    active ? "font-semibold text-primary" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {s.label}
                </span>
              </li>
              {idx < STEPS.length - 1 && (
                <div
                  className={[
                    "mb-4 h-0.5 flex-1",
                    done ? "bg-primary" : "bg-muted-foreground/20",
                  ].join(" ")}
                  aria-hidden
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Paso 1: Seleccionar orden ─────────────────────────────────────────────────

interface Step1Props {
  onNext: (orden: OrdenSeleccionada) => void;
}

function Step1SeleccionarOrden({ onNext }: Step1Props) {
  const [selected, setSelected] = React.useState<OrdenSeleccionada | null>(null);
  const [page, setPage] = React.useState(1);

  const { data, isLoading } = trpc.eceBridgeAdmision.listOrdenesPendientesAdmision.useQuery({
    page,
    pageSize: 20,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" aria-hidden />
          Paso 1 — Seleccionar orden de ingreso pendiente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Seleccione una orden de ingreso validada por Médico Coordinador para iniciar la admisión.
        </p>

        {isLoading && (
          <p className="text-sm text-muted-foreground" role="status">
            Cargando órdenes…
          </p>
        )}

        {!isLoading && data?.items.length === 0 && (
          <p className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
            No hay órdenes de ingreso pendientes de admisión.
          </p>
        )}

        {data && data.items.length > 0 && (
          <div className="divide-y rounded-md border" role="list" aria-label="Órdenes pendientes">
            {data.items.map((orden) => {
              const isSel = selected?.id === orden.id;
              return (
                <button
                  key={orden.id}
                  type="button"
                  role="listitem"
                  aria-pressed={isSel}
                  onClick={() => setSelected(orden)}
                  className={[
                    "w-full px-4 py-3 text-left text-sm transition-colors hover:bg-muted",
                    isSel ? "bg-primary/10 ring-1 ring-inset ring-primary" : "",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-medium">{orden.pacienteNombre}</span>
                      {orden.servicioNombre && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          {orden.servicioNombre}
                        </Badge>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {orden.antiguedadMinutos < 60
                        ? `${orden.antiguedadMinutos} min`
                        : `${Math.floor(orden.antiguedadMinutos / 60)} h`}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {orden.circunstanciaIngreso} · {orden.modalidad}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Paginación simple */}
        {data && data.total > data.pageSize && (
          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span className="flex items-center text-xs text-muted-foreground">
              Página {data.page} de {Math.ceil(data.total / data.pageSize)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        )}

        {selected && (
          <div
            className="rounded-md border bg-muted/40 p-3 text-sm"
            role="status"
            aria-live="polite"
          >
            <span className="font-medium">Seleccionado:</span> {selected.pacienteNombre}
            {" — "}{selected.servicioNombre ?? "Sin servicio asignado"}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            disabled={!selected}
            onClick={() => selected && onNext(selected)}
          >
            Continuar a datos de admisión
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Paso 2: Datos de admisión ─────────────────────────────────────────────────

interface DatosAdmision {
  camaId: string;
  modalidad: string;
  procedencia: string;
  fechaHoraIngreso: string;
}

interface Step2Props {
  orden: OrdenSeleccionada;
  onBack: () => void;
  onNext: (datos: DatosAdmision) => void;
}

function Step2DatosAdmision({ orden, onBack, onNext }: Step2Props) {
  const [camaId, setCamaId] = React.useState("");
  const [modalidad, setModalidad] = React.useState(orden.modalidad);
  const [procedencia, setProcedencia] = React.useState(orden.procedencia);
  const [fechaHoraIngreso, setFechaHoraIngreso] = React.useState(
    new Date().toISOString().slice(0, 16),
  );

  const canContinue =
    modalidad.trim().length > 0 &&
    procedencia.trim().length > 0 &&
    fechaHoraIngreso.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BedDouble className="h-5 w-5" aria-hidden />
          Paso 2 — Datos de admisión
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Info auto-rellenada de la orden */}
        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
          <p><span className="font-medium">Paciente:</span> {orden.pacienteNombre}</p>
          <p><span className="font-medium">Servicio destino:</span> {orden.servicioNombre ?? "—"}</p>
          <p><span className="font-medium">Circunstancia:</span> {orden.circunstanciaIngreso}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="adm-modalidad">Modalidad hospitalaria *</Label>
            <Input
              id="adm-modalidad"
              value={modalidad}
              onChange={(e) => setModalidad(e.target.value)}
              placeholder="internamiento, hospital_dia…"
              aria-required="true"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adm-procedencia">Procedencia *</Label>
            <Input
              id="adm-procedencia"
              value={procedencia}
              onChange={(e) => setProcedencia(e.target.value)}
              placeholder="domicilio, emergencia, traslado…"
              aria-required="true"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adm-fecha">Fecha y hora de ingreso *</Label>
            <Input
              id="adm-fecha"
              type="datetime-local"
              value={fechaHoraIngreso}
              onChange={(e) => setFechaHoraIngreso(e.target.value)}
              aria-required="true"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adm-cama">
              ID de cama{" "}
              <span className="text-muted-foreground text-xs">(UUID, opcional)</span>
            </Label>
            <Input
              id="adm-cama"
              value={camaId}
              onChange={(e) => setCamaId(e.target.value)}
              placeholder="ej. 00000000-0000-0000-0000-000000000000"
            />
          </div>
        </div>

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            Volver
          </Button>
          <Button
            disabled={!canContinue}
            onClick={() =>
              onNext({
                camaId: camaId.trim(),
                modalidad: modalidad.trim(),
                procedencia: procedencia.trim(),
                // Convertir datetime-local a ISO offset
                fechaHoraIngreso: new Date(fechaHoraIngreso).toISOString(),
              })
            }
          >
            Continuar a confirmación
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Paso 3: Confirmar y PIN ───────────────────────────────────────────────────

interface Step3Props {
  orden: OrdenSeleccionada;
  datos: DatosAdmision;
  onBack: () => void;
  onSuccess: (result: AdmisionResult) => void;
}

function Step3ConfirmarFirmar({ orden, datos, onBack, onSuccess }: Step3Props) {
  const [pin, setPin] = React.useState("");
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const admitir = trpc.eceBridgeAdmision.admitirDesdeOrden.useMutation({
    onSuccess: (result) => {
      onSuccess({
        episodioId: result.episodioId,
        episodioHospitalarioId: result.episodioHospitalarioId,
        hojaIngresoId: result.hojaIngresoId,
        camaAsignadaId: result.camaAsignadaId,
      });
    },
    onError: (e) => {
      setSubmitError(e.message);
    },
  });

  const handleSubmit = () => {
    setSubmitError(null);
    admitir.mutate({
      ordenIngresoId: orden.id,
      fechaHoraIngreso: datos.fechaHoraIngreso,
      camaId: datos.camaId.length > 0 ? datos.camaId : undefined,
      modalidad: datos.modalidad,
      procedencia: datos.procedencia,
      pinAdm: pin,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" aria-hidden />
          Paso 3 — Confirmar y firmar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2">
          <p className="font-semibold text-base">Resumen de admisión</p>
          <p><span className="font-medium">Paciente:</span> {orden.pacienteNombre}</p>
          <p><span className="font-medium">Servicio:</span> {orden.servicioNombre ?? "—"}</p>
          <p><span className="font-medium">Modalidad:</span> {datos.modalidad}</p>
          <p><span className="font-medium">Procedencia:</span> {datos.procedencia}</p>
          <p>
            <span className="font-medium">Fecha/hora ingreso:</span>{" "}
            {new Date(datos.fechaHoraIngreso).toLocaleString("es-SV")}
          </p>
          {datos.camaId && (
            <p><span className="font-medium">Cama ID:</span> {datos.camaId}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="adm-pin">
            PIN de firma electrónica ADM *
          </Label>
          <Input
            id="adm-pin"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Ingrese su PIN"
            maxLength={20}
            autoComplete="current-password"
            aria-required="true"
          />
          <p className="text-xs text-muted-foreground">
            Su firma electrónica quedará registrada en el documento ECE.
          </p>
        </div>

        {submitError && (
          <p
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {submitError}
          </p>
        )}

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack} disabled={admitir.isPending}>
            Volver
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pin.length < 4 || admitir.isPending}
            className="bg-[#1a3c6e] text-white hover:bg-[#15305a]"
          >
            {admitir.isPending ? "Procesando admisión…" : "Admitir paciente"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Pantalla de éxito ─────────────────────────────────────────────────────────

function AdmisionExitosa({ result, pacienteNombre }: {
  result: AdmisionResult;
  pacienteNombre: string;
}) {
  const router = useRouter();
  return (
    <Card>
      <CardContent className="py-8 text-center space-y-4">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" aria-hidden />
        <h2 className="text-xl font-bold">Admisión completada</h2>
        <p className="text-sm text-muted-foreground">
          {pacienteNombre} ha sido admitido exitosamente.
        </p>
        <ul className="mx-auto max-w-sm space-y-2 text-left text-sm">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
            Episodio creado: <code className="text-xs">{result.episodioId.slice(0, 8)}…</code>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
            Hoja de ingreso firmada: <code className="text-xs">{result.hojaIngresoId.slice(0, 8)}…</code>
          </li>
          {result.camaAsignadaId && (
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
              Cama asignada
            </li>
          )}
        </ul>
        <div className="flex justify-center gap-3 pt-2">
          <Button variant="outline" onClick={() => router.push("/ece/hoja-ingreso")}>
            Ver hojas de ingreso
          </Button>
          <Button onClick={() => router.push("/ece/admisiones-pendientes")}>
            Cola de admisiones
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Wizard root ───────────────────────────────────────────────────────────────

export default function NuevaHojaIngresoPage() {
  const [step, setStep] = React.useState<Step>(1);
  const [orden, setOrden] = React.useState<OrdenSeleccionada | null>(null);
  const [datos, setDatos] = React.useState<DatosAdmision | null>(null);
  const [result, setResult] = React.useState<AdmisionResult | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva hoja de ingreso</h1>
        <p className="text-sm text-muted-foreground">
          Admisión hospitalaria desde orden de ingreso validada.
        </p>
      </div>

      {step !== "success" && <StepIndicator current={step} />}

      {step === 1 && (
        <Step1SeleccionarOrden
          onNext={(o) => {
            setOrden(o);
            setStep(2);
          }}
        />
      )}

      {step === 2 && orden && (
        <Step2DatosAdmision
          orden={orden}
          onBack={() => setStep(1)}
          onNext={(d) => {
            setDatos(d);
            setStep(3);
          }}
        />
      )}

      {step === 3 && orden && datos && (
        <Step3ConfirmarFirmar
          orden={orden}
          datos={datos}
          onBack={() => setStep(2)}
          onSuccess={(r) => {
            setResult(r);
            setStep("success");
          }}
        />
      )}

      {step === "success" && result && orden && (
        <AdmisionExitosa result={result} pacienteNombre={orden.pacienteNombre} />
      )}
    </div>
  );
}
