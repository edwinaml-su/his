"use client";

/**
 * US-4.4 — Wizard de merge de pacientes.
 *
 * URL: /patients/merge?from=<uuid>&to=<uuid>
 *
 * Layout 2-columnas:
 *  - Header con banner de auditoría inmutable.
 *  - `MergeComparison` (lado a lado, radio buttons por field).
 *  - Justificación textarea (≥20 chars).
 *  - Confirmar.
 *
 * Tras el merge, se redirige a la ficha del paciente "to".
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";
import { MergeComparison, type MergeChoice } from "./merge-comparison";

type FieldKey = Parameters<typeof MergeComparison>[0]["value"] extends Partial<Record<infer K, MergeChoice>>
  ? K
  : never;

export default function PatientMergePage() {
  const router = useRouter();
  const sp = useSearchParams();
  const fromId = sp.get("from") ?? "";
  const toId = sp.get("to") ?? "";
  const enabled = fromId.length > 0 && toId.length > 0 && fromId !== toId;

  const fromQ = trpc.patient.get.useQuery({ id: fromId }, { enabled });
  const toQ = trpc.patient.get.useQuery({ id: toId }, { enabled });

  const [fields, setFields] = React.useState<Partial<Record<FieldKey, MergeChoice>>>({});
  const [justification, setJustification] = React.useState("");
  const [toast, setToast] = React.useState<{ title: string; description?: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const utils = trpc.useUtils();
  const merge = trpc.patient.mergePatients.useMutation({
    onSuccess: async (data) => {
      setToast({
        title: "Pacientes fusionados",
        description: `Acción auditada. Paciente superviviente: ${data.toPatientId}.`,
      });
      await utils.patient.get.invalidate({ id: data.toPatientId });
      setTimeout(() => router.push(`/patients/${data.toPatientId}`), 800);
    },
    onError: (err) => setError(err.message),
  });

  if (!enabled) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Fusionar pacientes</h1>
        <Alert variant="destructive">
          <AlertTitle>Parámetros faltantes o inválidos</AlertTitle>
          <AlertDescription>
            Se requieren <code>?from=</code> y <code>?to=</code> distintos en la URL.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link href="/patients">Volver</Link>
        </Button>
      </div>
    );
  }

  if (fromQ.isLoading || toQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando pacientes…</p>;
  }
  if (fromQ.error || toQ.error || !fromQ.data || !toQ.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error cargando pacientes</AlertTitle>
        <AlertDescription>
          {fromQ.error?.message ?? toQ.error?.message ?? "Datos no disponibles."}
        </AlertDescription>
      </Alert>
    );
  }

  const canSubmit = justification.trim().length >= 20 && !merge.isPending;

  function handleSubmit() {
    setError(null);
    merge.mutate({
      fromPatientId: fromId,
      toPatientId: toId,
      justification: justification.trim(),
      fieldsToTake: fields as Record<string, MergeChoice>,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Fusionar pacientes</h1>
        <p className="text-sm text-muted-foreground">
          US-4.4 — Selecciona qué versión de cada campo se conserva.
        </p>
      </div>

      <Alert>
        <AlertTitle>Esta acción es auditada e inmutable</AlertTitle>
        <AlertDescription>
          Toda fusión queda registrada en el log de auditoría con tu usuario, IP y
          justificación. Puede revertirse en los próximos 7 días, pero las
          relaciones (encuentros, identificadores, alergias) reasignadas
          permanecerán en el paciente superviviente.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Comparación de datos</CardTitle>
        </CardHeader>
        <CardContent>
          <MergeComparison
            from={fromQ.data}
            to={toQ.data}
            value={fields}
            onChange={setFields}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Justificación clínica</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="justification">
            Motivo del merge (≥ 20 caracteres)
          </Label>
          <textarea
            id="justification"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={4}
            placeholder="Ej.: Mismo paciente registrado dos veces tras admisión por triage. Se confirma DUI y fecha de nacimiento."
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {justification.trim().length}/20 caracteres mínimos.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={`/patients/${toId}`}>Cancelar</Link>
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {merge.isPending ? "Fusionando…" : "Confirmar fusión"}
        </Button>
      </div>

      {toast ? (
        <Toast open={Boolean(toast)} onOpenChange={(o) => !o && setToast(null)}>
          <ToastTitle>{toast.title}</ToastTitle>
          {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
        </Toast>
      ) : null}
    </div>
  );
}
