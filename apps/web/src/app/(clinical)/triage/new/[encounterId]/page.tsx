"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Label } from "@his/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@his/ui/components/select";
import { VitalSignsCapture, type VitalSignValue } from "@his/ui/components/VitalSignsCapture";
import { trpc } from "@/lib/trpc/react";

/**
 * Formulario triage Manchester (TDR §9.2).
 * Sprint 1: selecciona flujograma + nivel + signos vitales.
 * TODO(Sprint 2): selección de discriminadores positivos para sugerir nivel.
 */
export default function NewTriagePage() {
  const router = useRouter();
  const params = useParams<{ encounterId: string }>();
  const encounter = trpc.encounter.list.useQuery({ status: "OPEN", page: 1, pageSize: 100 });
  const enc = encounter.data?.items.find((e) => e.id === params.encounterId);
  const flowcharts = trpc.triage.listFlowcharts.useQuery();
  const levels = trpc.triage.listLevels.useQuery();

  const create = trpc.triage.createEvaluation.useMutation({
    onSuccess: () => router.replace("/triage"),
  });

  const [flowchartId, setFlowchartId] = React.useState("");
  const [assignedLevelId, setAssignedLevelId] = React.useState("");
  const [vitals, setVitals] = React.useState<VitalSignValue[]>([]);

  if (!enc && encounter.isFetched) {
    return <p className="text-sm text-destructive">Encuentro no encontrado o ya cerrado.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Evaluación de triage</h1>
      <Card>
        <CardHeader><CardTitle>Datos clínicos</CardTitle></CardHeader>
        <CardContent>
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              if (!enc) return;
              create.mutate({
                patientId: enc.patient.id,
                encounterId: enc.id,
                flowchartId,
                assignedLevelId,
                vitalSigns: vitals,
                discriminatorHits: [],
              });
            }}
          >
            <FormField>
              <Label>Flujograma</Label>
              <Select value={flowchartId} onValueChange={setFlowchartId}>
                <SelectTrigger><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {flowcharts.data?.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label>Nivel asignado</Label>
              <Select value={assignedLevelId} onValueChange={setAssignedLevelId}>
                <SelectTrigger><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {levels.data?.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.color} — {l.name} (≤{l.maxWaitMinutes} min)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label>Signos vitales</Label>
              <VitalSignsCapture value={vitals} onChange={setVitals} />
            </FormField>
            <FormError>{create.error?.message}</FormError>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Guardando…" : "Registrar"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
