"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { AllergyAlert } from "@his/ui/components/AllergyAlert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";
import { PatientShellBar } from "@/components/patient-shell-bar";

/**
 * Vista 360° del paciente (TDR §8.1).
 * TODO(Sprint 2): historia clínica resumida, encuentros, signos vitales, órdenes.
 */
export default function PatientDetailPage() {
  const params = useParams<{ id: string }>();
  const query = trpc.patient.get.useQuery({ id: params.id });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (query.error) return <p className="text-sm text-destructive">{query.error.message}</p>;
  const p = query.data!;

  return (
    <div className="space-y-4">
      <PatientShellBar patientId={params.id} />
      <div>
        <h1 className="text-2xl font-bold">
          {p.lastName}
          {p.secondLastName ? ` ${p.secondLastName}` : ""}, {p.firstName}
        </h1>
        <p className="text-xs font-mono text-muted-foreground">MRN {p.mrn}</p>
      </div>

      <AllergyAlert
        allergies={p.allergies.map((a) => ({
          id: a.id,
          substanceText: a.substanceText,
          severity: a.severity as "mild" | "moderate" | "severe" | "life-threatening",
          reaction: a.reaction,
        }))}
      />

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ids">Identificadores</TabsTrigger>
          <TabsTrigger value="contact">Contacto</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <Card>
            <CardHeader><CardTitle>Datos generales</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <p><span className="text-muted-foreground">Fecha de nacimiento: </span>{p.birthDate ? new Date(p.birthDate).toLocaleDateString("es-SV") : "—"}</p>
              <p><span className="text-muted-foreground">Sexo biológico: </span>{p.biologicalSex?.name ?? "—"}</p>
              <p><span className="text-muted-foreground">Género: </span>{p.gender?.name ?? "—"}</p>
              <p><span className="text-muted-foreground">Estado civil: </span>{p.maritalStatus?.name ?? "—"}</p>
              <p><span className="text-muted-foreground">Tipo de sangre: </span>{p.bloodTypeAbo ?? "—"} {p.bloodRh ?? ""}</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="ids">
          <Card>
            <CardHeader><CardTitle>Identificadores</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {p.identifiers.length === 0 ? (
                <p className="text-muted-foreground">Sin identificadores registrados.</p>
              ) : (
                <ul className="space-y-1">
                  {p.identifiers.map((i) => (
                    <li key={i.id} className="font-mono">
                      {i.identifierType.code}: {i.value}
                      {i.isPrimary ? <span className="ml-2 text-xs text-primary">(primario)</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="contact">
          <Card>
            <CardHeader><CardTitle>Contacto</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <p className="font-medium">Teléfonos</p>
                {p.phones.length === 0 ? <p className="text-muted-foreground">—</p> : (
                  <ul>{p.phones.map((ph) => <li key={ph.id} className="font-mono">{ph.phone}</li>)}</ul>
                )}
              </div>
              <div>
                <p className="font-medium">Direcciones</p>
                {p.addresses.length === 0 ? <p className="text-muted-foreground">—</p> : (
                  <ul>{p.addresses.map((a) => <li key={a.id}>{a.line1}</li>)}</ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
