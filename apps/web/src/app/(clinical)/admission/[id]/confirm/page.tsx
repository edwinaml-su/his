"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

/**
 * US-5.1 + US.F2.6.1 — Pantalla post-admisión.
 *
 * Muestra resumen del encuentro y permite imprimir/reimprimir la pulsera GSRN.
 */
export default function AdmissionConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const list = trpc.encounter.listOpenByOrg.useQuery({
    page: 1,
    pageSize: 100,
  });

  const enc = list.data?.items.find((e) => e.id === id);
  const patientId = enc?.patient.id ?? "";

  const gsrnQuery = trpc.gsrnPulsera.get.useQuery(
    { patientId },
    { enabled: !!patientId },
  );

  const printMutation = trpc.gsrnPulsera.print.useMutation();
  const reprintMutation = trpc.gsrnPulsera.reprint.useMutation();
  const assignMutation = trpc.gsrnPulsera.assign.useMutation({
    onSuccess: () => void gsrnQuery.refetch(),
  });

  if (list.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (!enc) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          Encuentro no encontrado entre los abiertos. Puede haber sido cerrado.
        </p>
        <Button asChild variant="outline">
          <Link href="/admission">Volver a admisión</Link>
        </Button>
      </div>
    );
  }

  const bed = enc.bedAssignments[0]?.bed ?? null;
  const gsrn = gsrnQuery.data?.gsrn;
  const isPrinting = printMutation.isPending;
  const isReprinting = reprintMutation.isPending;

  function handlePrint() {
    printMutation.mutate({ patientId });
  }

  function handleReprint() {
    reprintMutation.mutate({ patientId });
  }

  function handleAssignGsrn() {
    assignMutation.mutate({ patientId });
  }

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

      {/* US.F2.6.1 — Pulsera GSRN */}
      <Card>
        <CardHeader>
          <CardTitle>Pulsera de Identificación (GSRN)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {gsrnQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando GSRN…</p>
          ) : gsrn ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">GSRN:</span>
                <code className="rounded bg-muted px-2 py-0.5 text-sm font-mono">
                  {gsrn}
                </code>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handlePrint}
                  disabled={isPrinting}
                >
                  {isPrinting ? "Imprimiendo…" : "Imprimir Pulsera"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReprint}
                  disabled={isReprinting}
                >
                  {isReprinting ? "Reimprimiendo…" : "Reimprimir Pulsera"}
                </Button>
              </div>
              {printMutation.isSuccess && (
                <p className="text-sm text-green-700">
                  Pulsera enviada a impresora.
                </p>
              )}
              {reprintMutation.isSuccess && (
                <p className="text-sm text-green-700">
                  Reimpresión enviada a impresora.
                </p>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                GSRN no asignado. El sistema lo asigna automáticamente al
                confirmar admisión. Si no se asignó, puede hacerlo manualmente.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleAssignGsrn}
                disabled={assignMutation.isPending}
              >
                {assignMutation.isPending ? "Asignando…" : "Asignar GSRN"}
              </Button>
              {assignMutation.isError && (
                <p className="text-sm text-destructive">
                  {assignMutation.error.message}
                </p>
              )}
            </div>
          )}
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
