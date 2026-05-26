"use client";

/**
 * US.F2.7.43 — Vista del expediente propio del paciente (Portal).
 *
 * El paciente autenticado ve:
 *   - Datos demográficos básicos
 *   - Episodios de atención (últimos 20)
 *   - Diagnósticos vinculados
 *
 * Excluye notas internas, drafts, notas confidenciales (filtro en servidor).
 * URL: /mi-expediente (portal)
 */

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

export default function MiExpedientePage() {
  const expediente = trpc.portal.expediente.getMiExpediente.useQuery({});

  if (expediente.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando tu expediente…</p>;
  }

  if (expediente.error) {
    return (
      <p className="text-sm text-destructive">
        Error al cargar tu expediente: {expediente.error.message}
      </p>
    );
  }

  const { patient, encounters, diagnoses } = expediente.data ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mi expediente clínico</h1>
          <p className="text-sm text-muted-foreground">
            Ley de Protección de Datos Personales Art. 9 — Derecho de acceso.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/solicitudes-arco">Solicitar corrección / supresión</Link>
        </Button>
      </div>

      {patient ? (
        <Card>
          <CardHeader>
            <CardTitle>Datos del paciente</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Nombre completo</p>
              <p className="font-medium">
                {patient.lastName}
                {patient.secondLastName ? ` ${patient.secondLastName}` : ""},{" "}
                {patient.firstName}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">MRN</p>
              <p className="font-mono font-medium">{patient.mrn}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Fecha de nacimiento</p>
              <p className="font-medium">
                {patient.birthDate
                  ? new Date(patient.birthDate).toLocaleDateString("es-SV", { timeZone: "UTC" })
                  : "No registrada"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Sexo biológico</p>
              <p className="font-medium">{patient.biologicalSex.name}</p>
            </div>
            {patient.identifiers[0] ? (
              <div>
                <p className="text-muted-foreground">Identificador principal</p>
                <p className="font-medium">
                  {patient.identifiers[0].kind}: {patient.identifiers[0].value}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Episodios de atención</CardTitle>
          <CardDescription>Últimas 20 visitas registradas.</CardDescription>
        </CardHeader>
        <CardContent>
          {!encounters || encounters.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin episodios de atención registrados.</p>
          ) : (
            <div className="space-y-2">
              {encounters.map((enc) => (
                <div
                  key={enc.id}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium font-mono text-xs text-muted-foreground">
                      {enc.encounterNumber}
                    </p>
                    <p className="text-muted-foreground">
                      {enc.admittedAt
                        ? new Date(enc.admittedAt).toLocaleDateString("es-SV", { timeZone: "UTC" })
                        : "—"}
                      {enc.dischargedAt
                        ? ` · Alta ${new Date(enc.dischargedAt).toLocaleDateString("es-SV", { timeZone: "UTC" })}`
                        : " · En curso"}
                    </p>
                  </div>
                  <div>
                    <Badge variant="outline" className="capitalize text-xs">
                      {enc.admissionType}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Diagnósticos</CardTitle>
          <CardDescription>Registros de diagnóstico de tus atenciones.</CardDescription>
        </CardHeader>
        <CardContent>
          {!diagnoses || diagnoses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin diagnósticos registrados.</p>
          ) : (
            <div className="space-y-1">
              {diagnoses.map((d) => (
                <div key={d.id} className="flex items-center gap-3 text-sm">
                  <Badge variant="outline" className="text-xs">
                    {d.type}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{d.conceptId}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {new Date(d.diagnosedAt).toLocaleDateString("es-SV", { timeZone: "UTC" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
