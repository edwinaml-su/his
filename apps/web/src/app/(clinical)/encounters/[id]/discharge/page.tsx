"use client";

/**
 * US-5.5 — Página de alta + epicrisis (equipo Lima · Sprint 3).
 *
 * Wizard de 2 pasos:
 *   1. Tipo de alta + diagnóstico principal CIE-10.
 *   2. Epicrisis (resumen, indicaciones, próxima cita) +
 *      confirmación destructiva.
 *
 * Submit final invoca `encounterDischarge.dischargeEncounter`. Tras
 * éxito, redirige a `/encounters/[id]` y muestra la epicrisis
 * resultante leída desde `encounterDischarge.epicrisis`.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";
import {
  DischargeForm,
  type DischargeFormState,
} from "./discharge-form";
import {
  EpicrisisForm,
  type EpicrisisFormState,
} from "./epicrisis-form";

type Step = "discharge" | "epicrisis";

export default function DischargePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const encounterId = params.id;

  // Datos del encuentro (para encabezado).
  const list = trpc.encounter.list.useQuery({
    status: "ALL",
    page: 1,
    pageSize: 50,
  });
  const enc = list.data?.items.find((e) => e.id === encounterId);

  const [step, setStep] = React.useState<Step>("discharge");

  const [data, setData] = React.useState<DischargeFormState>({
    dischargeType: "MEDICAL",
    primaryDiagnosisCode: "",
    primaryDiagnosisDesc: "",
  });

  const [epi, setEpi] = React.useState<EpicrisisFormState>({
    summary: "",
    indicationsHome: "",
    followUpAt: "",
    followUpNotes: "",
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const discharge = (trpc as any).encounterDischarge.dischargeEncounter.useMutation(
    {
      onSuccess: () => {
        router.replace(`/encounters/${encounterId}`);
      },
    },
  );

  function submit() {
    discharge.mutate({
      encounterId,
      dischargeType: data.dischargeType,
      primaryDiagnosisCode: data.primaryDiagnosisCode.trim(),
      primaryDiagnosisDesc: data.primaryDiagnosisDesc.trim(),
      summary: epi.summary.trim() || undefined,
      indicationsHome: epi.indicationsHome.trim() || undefined,
      followUpAppointment: epi.followUpAt
        ? {
            at: new Date(epi.followUpAt),
            notes: epi.followUpNotes.trim() || undefined,
          }
        : undefined,
    });
  }

  if (enc?.dischargedAt) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Encuentro ya egresado</h1>
        <p className="text-sm text-muted-foreground">
          {enc.encounterNumber} fue dado de alta el{" "}
          {new Date(enc.dischargedAt).toLocaleString("es-SV")}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Egreso del encuentro</h1>
        {enc ? (
          <p className="text-sm text-muted-foreground">
            {enc.encounterNumber} ·{" "}
            <span className="font-medium text-foreground">
              {enc.patient.firstName} {enc.patient.lastName}
            </span>{" "}
            · MRN {enc.patient.mrn}{" "}
            <Badge variant="success" className="ml-2">
              Abierto
            </Badge>
          </p>
        ) : null}
      </div>

      {/* Stepper */}
      <ol className="flex items-center gap-2 text-sm">
        {[
          { id: "discharge", label: "Tipo + Diagnóstico" },
          { id: "epicrisis", label: "Epicrisis" },
        ].map((s, i) => {
          const active = s.id === step;
          const done =
            (step === "epicrisis" && s.id === "discharge") || false;
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
              <span
                className={
                  active ? "font-semibold" : "text-muted-foreground"
                }
              >
                {s.label}
              </span>
              {i === 0 ? (
                <span className="mx-1 text-muted-foreground">›</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>
            {step === "discharge"
              ? "Tipo de alta y diagnóstico principal"
              : "Epicrisis y confirmación"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === "discharge" ? (
            <DischargeForm
              value={data}
              onChange={setData}
              onCancel={() => router.replace(`/encounters/${encounterId}`)}
              onContinue={() => setStep("epicrisis")}
            />
          ) : (
            <EpicrisisForm
              value={epi}
              onChange={setEpi}
              onBack={() => setStep("discharge")}
              onConfirm={submit}
              isSubmitting={discharge.isPending}
              error={discharge.error?.message ?? null}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
