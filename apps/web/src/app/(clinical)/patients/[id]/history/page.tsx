"use client";

/**
 * US-4.8 — Antecedentes clínicos: vista con tabs.
 *
 * Carga snapshot vigente vía `patientHistory.get`, lo edita en memoria y
 * persiste con `patientHistory.update`. Cada save crea un nuevo audit log
 * append-only (ver patient-history.router.ts para la decisión de storage).
 *
 * Tabs:
 *  - familiares
 *  - personales
 *  - gineco-obstétricos (visible solo si paciente con biologicalSex=F)
 *  - pediátricos (visible solo si paciente menor de 18 años)
 */
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@his/ui/components/tabs";
import { Button } from "@his/ui/components/button";
import { FormError } from "@his/ui/components/form";
import { trpc } from "@/lib/trpc/react";
import type {
  PatientHistory,
  FamilialHistory,
  PersonalHistory,
  GynecoHistory,
  PediatricHistory,
} from "@his/contracts";
import { FamilialHistoryForm } from "./familial";
import { PersonalHistoryForm } from "./personal";
import { GynecoHistoryForm } from "./gyneco";
import { PediatricHistoryForm } from "./pediatric";

const PEDIATRIC_MAX_AGE_YEARS = 18;

function defaultFamilial(): FamilialHistory {
  return {
    diabetes: false,
    hypertension: false,
    cancer: { present: false, detail: null },
    heartDisease: false,
    mentalIllness: false,
    other: null,
  };
}
function defaultPersonal(): PersonalHistory {
  return {
    chronicConditions: [],
    surgeries: [],
    allergyRefs: [],
    medications: [],
    habits: { tobacco: false, alcohol: false, drugs: false, detail: null },
  };
}
function defaultGyneco(): GynecoHistory {
  return {
    menarcheAge: null,
    cycle: null,
    lastPeriod: null,
    gpac: { G: 0, P: 0, A: 0, C: 0 },
    contraceptiveMethod: null,
    notes: null,
  };
}
function defaultPediatric(): PediatricHistory {
  return {
    gestationalAgeWeeks: null,
    birthWeightGrams: null,
    breastfeeding: { given: false, months: null, exclusiveMonths: null },
    milestones: null,
    immunizationsUpToDate: false,
  };
}

function ageInYears(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = typeof birthDate === "string" ? new Date(birthDate) : birthDate;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
}

export default function PatientHistoryPage() {
  const params = useParams<{ id: string }>();
  const patientId = params.id;

  const patientQ = trpc.patient.get.useQuery({ id: patientId });
  const historyQ = trpc.patientHistory.get.useQuery({ patientId });
  const utils = trpc.useUtils();
  const update = trpc.patientHistory.update.useMutation({
    onSuccess: () => utils.patientHistory.get.invalidate({ patientId }),
  });

  const [draft, setDraft] = React.useState<PatientHistory | null>(null);

  // Inicializar draft desde el snapshot servidor.
  React.useEffect(() => {
    if (historyQ.data?.history && !draft) {
      setDraft(historyQ.data.history);
    }
  }, [historyQ.data, draft]);

  if (patientQ.isLoading || historyQ.isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  if (patientQ.error)
    return <p className="text-sm text-destructive">{patientQ.error.message}</p>;
  if (historyQ.error)
    return <p className="text-sm text-destructive">{historyQ.error.message}</p>;

  const patient = patientQ.data!;
  const isFemale = patient.biologicalSex?.code === "F";
  const ageYears = ageInYears(patient.birthDate);
  const isPediatric = ageYears !== null && ageYears < PEDIATRIC_MAX_AGE_YEARS;

  const onSave = () => {
    if (!draft) return;
    update.mutate({ patientId, history: draft });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Antecedentes clínicos</h1>
          <p className="text-xs text-muted-foreground">
            {patient.lastName}, {patient.firstName} · MRN {patient.mrn}
            {historyQ.data?.updatedAt && (
              <>
                {" "}· Actualizado{" "}
                {new Date(historyQ.data.updatedAt).toLocaleString("es-SV")}
              </>
            )}
          </p>
        </div>
        <Button onClick={onSave} disabled={update.isPending}>
          {update.isPending ? "Guardando…" : "Guardar antecedentes"}
        </Button>
      </div>

      <FormError>{update.error?.message}</FormError>

      <Tabs defaultValue="familial">
        <TabsList>
          <TabsTrigger value="familial">Familiares</TabsTrigger>
          <TabsTrigger value="personal">Personales</TabsTrigger>
          {isFemale && <TabsTrigger value="gyneco">Gineco-obstétricos</TabsTrigger>}
          {isPediatric && <TabsTrigger value="pediatric">Pediátricos</TabsTrigger>}
        </TabsList>

        <TabsContent value="familial">
          <FamilialHistoryForm
            value={draft.familial ?? defaultFamilial()}
            onChange={(v) => setDraft({ ...draft, familial: v })}
          />
        </TabsContent>

        <TabsContent value="personal">
          <PersonalHistoryForm
            value={draft.personal ?? defaultPersonal()}
            onChange={(v) => setDraft({ ...draft, personal: v })}
            allergies={(patient.allergies ?? []).map((a) => ({
              id: a.id,
              substanceText: a.substanceText,
              severity: a.severity,
            }))}
          />
        </TabsContent>

        {isFemale && (
          <TabsContent value="gyneco">
            <GynecoHistoryForm
              value={draft.gyneco ?? defaultGyneco()}
              onChange={(v) => setDraft({ ...draft, gyneco: v })}
            />
          </TabsContent>
        )}

        {isPediatric && (
          <TabsContent value="pediatric">
            <PediatricHistoryForm
              value={draft.pediatric ?? defaultPediatric()}
              onChange={(v) => setDraft({ ...draft, pediatric: v })}
            />
          </TabsContent>
        )}
      </Tabs>

      {!isFemale && !isPediatric && (
        <Card>
          <CardHeader>
            <CardTitle>Información</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Tabs gineco-obstétrico y pediátrico ocultos según perfil del paciente.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
