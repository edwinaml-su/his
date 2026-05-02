"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { PatientSearchBar } from "@his/ui/components/PatientSearchBar";
import { trpc } from "@/lib/trpc/react";
import {
  AdmissionForm,
  type AdmissionFormState,
  type AdmissionType,
} from "./admission-form";
import { BedAssignmentStep } from "./bed-assignment-step";

type Step = "patient" | "data" | "bed" | "confirm";

const STEPS: { id: Step; label: string }[] = [
  { id: "patient", label: "Paciente" },
  { id: "data", label: "Datos" },
  { id: "bed", label: "Cama" },
  { id: "confirm", label: "Confirmar" },
];

interface PatientHit {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
}

/**
 * US-5.1 / US-5.2 — Wizard de admisión completo.
 *
 * Flujo:
 *   1. Paciente: buscar y seleccionar (o ir a /patients/new si no existe).
 *   2. Datos: tipo de admisión + servicio + moneda + datos administrativos.
 *   3. Cama: requerido si SCHEDULED, opcional si EMERGENCY/TRANSFER_IN.
 *   4. Confirmar: resumen → submit `encounter.admit`.
 *
 * Idempotencia: si el paciente ya tiene un encuentro abierto, el server lo
 * retorna y la UI redirige a `/admission/{id}/confirm` mostrando el aviso.
 */
export default function AdmissionPage() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("patient");

  // Step 1 — paciente.
  const [search, setSearch] = React.useState("");
  const patients = trpc.patient.search.useQuery(
    { query: search, limit: 10 },
    { enabled: search.trim().length >= 2 },
  );
  const [patient, setPatient] = React.useState<PatientHit | null>(null);

  // Step 2 — datos.
  const currencies = trpc.currency.list.useQuery();
  const services = trpc.bed.getMap.useQuery();
  const serviceUnits = React.useMemo(
    () =>
      services.data?.map((s) => ({ id: s.id, code: s.code, name: s.name })) ??
      [],
    [services.data],
  );

  const [data, setData] = React.useState<AdmissionFormState>({
    admissionType: "EMERGENCY",
    serviceUnitId: "",
    currencyId: "",
    isReferral: false,
    referralOrigin: "",
    accompanyingPersonName: "",
    chiefComplaint: "",
    valuables: "",
  });

  // Auto-elegir primera moneda (típicamente la funcional).
  React.useEffect(() => {
    if (!data.currencyId && currencies.data && currencies.data.length > 0) {
      setData((d) => ({ ...d, currencyId: currencies.data![0]!.id }));
    }
  }, [currencies.data, data.currencyId]);

  // Step 3 — cama.
  const [bedId, setBedId] = React.useState<string | null>(null);

  // Reset cama al cambiar tipo de admisión.
  const prevAdmissionType = React.useRef<AdmissionType>(data.admissionType);
  React.useEffect(() => {
    if (prevAdmissionType.current !== data.admissionType) {
      setBedId(null);
      prevAdmissionType.current = data.admissionType;
    }
  }, [data.admissionType]);

  // Submit.
  const admit = trpc.encounter.admit.useMutation({
    onSuccess: (enc) => {
      router.replace(`/admission/${enc.id}/confirm`);
    },
  });

  function submit() {
    if (!patient) return;
    admit.mutate({
      patientId: patient.id,
      admissionType: data.admissionType,
      serviceUnitId: data.serviceUnitId || undefined,
      currencyId: data.currencyId,
      bedId: bedId ?? undefined,
      isReferral: data.isReferral || undefined,
      referralOrigin: data.isReferral
        ? data.referralOrigin || undefined
        : undefined,
      accompanyingPersonName: data.accompanyingPersonName || undefined,
      chiefComplaint: data.chiefComplaint || undefined,
      valuables: data.valuables
        ? data.valuables
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    });
  }

  const bedRequired = data.admissionType === "SCHEDULED";
  const bedSelected = bedId
    ? services.data
        ?.flatMap((s) =>
          s.beds.map((b) => ({
            id: b.id,
            code: b.code,
            serviceUnitName: s.name,
          })),
        )
        .find((b) => b.id === bedId) ?? null
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Admisión</h1>
        <p className="text-sm text-muted-foreground">
          Wizard de admisión hospitalaria (US-5.1 / US-5.2).
        </p>
      </div>

      {/* Stepper */}
      <ol className="flex items-center gap-2 text-sm">
        {STEPS.map((s, i) => {
          const active = s.id === step;
          const done = STEPS.findIndex((x) => x.id === step) > i;
          return (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 font-semibold ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-success bg-success text-success-foreground"
                      : "border-muted text-muted-foreground"
                }`}
              >
                {i + 1}
              </span>
              <span className={active ? "font-semibold" : "text-muted-foreground"}>
                {s.label}
              </span>
              {i < STEPS.length - 1 ? (
                <span className="mx-1 text-muted-foreground">›</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS.find((s) => s.id === step)?.label}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === "patient" && (
            <div className="space-y-3">
              <PatientSearchBar onSearch={setSearch} />
              {patients.isLoading && (
                <p className="text-sm text-muted-foreground">Buscando…</p>
              )}
              {patients.data && patients.data.length === 0 && search.length >= 2 && (
                <p className="text-sm text-muted-foreground">
                  Sin resultados.{" "}
                  <a
                    href="/patients/new"
                    className="text-primary underline underline-offset-4"
                  >
                    Registrar nuevo paciente
                  </a>
                </p>
              )}
              <ul className="divide-y rounded-md border">
                {patients.data?.map((p) => {
                  const selected = patient?.id === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setPatient({
                            id: p.id,
                            mrn: p.mrn,
                            firstName: p.firstName,
                            lastName: p.lastName,
                          })
                        }
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                          selected ? "bg-muted" : ""
                        }`}
                      >
                        <span>
                          <span className="font-semibold">
                            {p.firstName} {p.lastName}
                          </span>
                          <span className="ml-2 text-muted-foreground">
                            MRN {p.mrn}
                          </span>
                        </span>
                        {selected && <Badge variant="success">Seleccionado</Badge>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {patient && (
                <p className="text-sm text-muted-foreground">
                  Paciente:{" "}
                  <span className="font-semibold text-foreground">
                    {patient.firstName} {patient.lastName}
                  </span>{" "}
                  · MRN {patient.mrn}
                </p>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={!patient}
                  onClick={() => setStep("data")}
                >
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === "data" && (
            <AdmissionForm
              value={data}
              onChange={setData}
              currencies={currencies.data ?? []}
              serviceUnits={serviceUnits}
              onBack={() => setStep("patient")}
              onContinue={() => {
                // Salta el paso de cama si no aplica (TRANSFER_IN sin cama).
                setStep("bed");
              }}
            />
          )}

          {step === "bed" && (
            <BedAssignmentStep
              required={bedRequired}
              serviceUnitId={data.serviceUnitId || undefined}
              selectedBedId={bedId}
              onSelectBed={setBedId}
              onBack={() => setStep("data")}
              onContinue={() => setStep("confirm")}
            />
          )}

          {step === "confirm" && patient && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Paciente</dt>
                  <dd className="font-semibold">
                    {patient.firstName} {patient.lastName}
                  </dd>
                  <dd className="text-muted-foreground">MRN {patient.mrn}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tipo de admisión</dt>
                  <dd className="font-semibold">{data.admissionType}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Servicio</dt>
                  <dd>
                    {serviceUnits.find((s) => s.id === data.serviceUnitId)
                      ?.name ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Cama</dt>
                  <dd>
                    {bedSelected
                      ? `${bedSelected.code} (${bedSelected.serviceUnitName})`
                      : bedRequired
                        ? "(falta)"
                        : "Sin asignar"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Motivo</dt>
                  <dd>{data.chiefComplaint || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Acompañante</dt>
                  <dd>{data.accompanyingPersonName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Referencia</dt>
                  <dd>
                    {data.isReferral ? data.referralOrigin || "Sí" : "No"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Valuables</dt>
                  <dd>{data.valuables || "—"}</dd>
                </div>
              </dl>

              {admit.error && (
                <p className="text-sm text-destructive">
                  {admit.error.message}
                </p>
              )}

              <div className="flex justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("bed")}
                >
                  Atrás
                </Button>
                <Button
                  type="button"
                  onClick={submit}
                  disabled={admit.isPending || !data.currencyId}
                >
                  {admit.isPending ? "Admitiendo…" : "Confirmar admisión"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Re-exporta tipo para que los sub-componentes mantengan su API documentada.
export type { AdmissionFormState };
