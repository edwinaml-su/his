"use client";

/**
 * US-5.6 — Flujo de certificado de defunción para un encuentro abierto.
 * Ruta: /encounters/[id]/death
 *
 * Carga el encuentro (vía encounter.list ALL en MVP) y monta el formulario
 * en 3 secciones. En éxito redirige al visor del certificado.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { trpc } from "@/lib/trpc/react";
import { DeathCertificateForm } from "./death-certificate-form";

export default function EncounterDeathPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const encounterId = params.id;

  const list = trpc.encounter.list.useQuery({
    status: "ALL",
    page: 1,
    pageSize: 100,
  });
  const enc = list.data?.items.find((e) => e.id === encounterId);

  if (list.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  if (!enc) {
    return (
      <p className="text-sm text-destructive">Encuentro no encontrado.</p>
    );
  }

  if (enc.dischargedAt) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Encuentro cerrado</CardTitle>
          <CardDescription>
            Este encuentro ya fue cerrado el{" "}
            {new Date(enc.dischargedAt).toLocaleString("es-SV")} con tipo{" "}
            <strong>{enc.dischargeType ?? "—"}</strong>. No puede emitirse un
            certificado de defunción sin reabrir el encuentro vía proceso
            administrativo.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Certificado médico de defunción</h1>
        <p className="text-sm text-muted-foreground">
          Encuentro {enc.encounterNumber}
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <DeathCertificateForm
            encounterId={enc.id}
            patientName={`${enc.patient.firstName} ${enc.patient.lastName}`}
            patientMrn={enc.patient.mrn}
            encounterAdmittedAt={new Date(enc.admittedAt)}
            onCreated={(certId) => {
              router.push(`/deaths/${certId}`);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
