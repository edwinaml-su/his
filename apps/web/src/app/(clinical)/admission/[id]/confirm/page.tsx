"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

/**
 * US-5.1 — Pantalla post-admisión.
 *
 * Recibe el `id` del encuentro recién creado (o el reusado por idempotencia)
 * y muestra el resumen: número de encuentro, paciente, servicio, cama
 * asignada y siguiente paso (triage, ver censo, ir al detalle).
 *
 * Estrategia de fetch: usamos `encounter.listOpenByOrg` con `pageSize=100`
 * y filtramos en cliente — evita pedir un nuevo endpoint `getById` que
 * pertenecería al patient/encounter team. Cuando US-5.4 lo agregue, este
 * componente debería migrar a `encounter.getById`.
 */
export default function AdmissionConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const list = trpc.encounter.listOpenByOrg.useQuery({
    page: 1,
    pageSize: 100,
  });

  const enc = list.data?.items.find((e) => e.id === id);

  if (list.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (!enc) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          Encuentro no encontrado entre los abiertos. Puede haber sido
          cerrado.
        </p>
        <Button asChild variant="outline">
          <Link href="/admission">Volver a admisión</Link>
        </Button>
      </div>
    );
  }

  const bed = enc.bedAssignments[0]?.bed ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admisión confirmada</h1>
          <p className="text-sm text-muted-foreground">
            Encuentro {enc.encounterNumber}
          </p>
        </div>
        <Badge variant="success">Abierto</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resumen</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Paciente</dt>
            <dd className="font-semibold">
              {enc.patient.firstName} {enc.patient.lastName}
            </dd>
            <dd className="text-muted-foreground">MRN {enc.patient.mrn}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tipo</dt>
            <dd className="font-semibold">{enc.admissionType}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Servicio</dt>
            <dd>{enc.serviceUnit?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cama</dt>
            <dd>
              {bed ? (
                <Badge variant="info">{bed.code}</Badge>
              ) : (
                <span className="text-muted-foreground">Sin asignar</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Admitido</dt>
            <dd>{new Date(enc.admittedAt).toLocaleString("es-SV")}</dd>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/encounters/${enc.id}`}>Ver encuentro</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/triage?patientId=${enc.patient.id}`}>Triage</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/beds">Mapa de camas</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/admission">Nueva admisión</Link>
        </Button>
      </div>
    </div>
  );
}
