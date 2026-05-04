"use client";

/**
 * US-5.6 — Visor read-only del certificado de defunción.
 * Acceso restringido a PHYSICIAN o ADMIN (validado en router.get).
 *
 * Layout: documento oficial con encabezado, datos del paciente, cadena
 * causal CIE-10, modo, médico certificante. Botón "Notificar Registro
 * Civil" (stub Sprint 6).
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Separator } from "@his/ui/components/separator";
import { trpc } from "@/lib/trpc/react";

type Manner = "natural" | "accident" | "suicide" | "homicide" | "undetermined";

const MANNER_LABEL: Record<Manner, string> = {
  natural: "Natural",
  accident: "Accidente",
  suicide: "Suicidio",
  homicide: "Homicidio",
  undetermined: "Indeterminado (autopsia pendiente)",
};

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-SV");
}

function CauseRow({
  label,
  code,
  desc,
}: {
  label: string;
  code: string | null | undefined;
  desc: string | null | undefined;
}) {
  if (!code && !desc) {
    return (
      <div className="grid grid-cols-[160px_1fr] gap-2 py-1 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">—</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>
        <span className="font-mono">{code}</span>
        {desc ? <span className="ml-2">{desc}</span> : null}
      </span>
    </div>
  );
}

export default function DeathCertificateDetailPage() {
  const params = useParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: cert, isLoading, error } = trpc.deathCertificate.get.useQuery({
    id: params.id,
  });

  const notify = trpc.deathCertificate.notifyCivilRegistry.useMutation({
    onSuccess: () => {
      utils.deathCertificate.get.invalidate({ id: params.id });
      utils.deathCertificate.list.invalidate();
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{error.message}</p>;
  }
  if (!cert) {
    return (
      <p className="text-sm text-destructive">Certificado no encontrado.</p>
    );
  }

  const manner = cert.manner as Manner | null | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Certificado médico de defunción
          </h1>
          <p className="text-sm text-muted-foreground">
            Documento N° {cert.id}
          </p>
        </div>
        <Link href="/deaths" className="text-sm text-primary underline">
          ← Volver al listado
        </Link>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-center text-xl uppercase tracking-wide">
            Acta de Certificación de Defunción
          </CardTitle>
          <p className="text-center text-xs text-muted-foreground">
            República de El Salvador · Sistema HIS Avante · TDR §8.7
          </p>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">
              Identificación del fallecido
            </h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Nombre: </span>
                <strong>
                  {cert.patient.firstName} {cert.patient.lastName}
                </strong>
              </div>
              <div>
                <span className="text-muted-foreground">MRN: </span>
                <span className="font-mono">{cert.patient.mrn}</span>
              </div>
              <div>
                <span className="text-muted-foreground">
                  Fecha de nacimiento:{" "}
                </span>
                {cert.patient.birthDate
                  ? new Date(cert.patient.birthDate).toLocaleDateString("es-SV")
                  : "—"}
              </div>
              <div>
                <span className="text-muted-foreground">
                  Encuentro asociado:{" "}
                </span>
                {cert.encounter ? (
                  <Link
                    className="text-primary underline"
                    href={`/encounters/${cert.encounter.id}`}
                  >
                    {cert.encounter.encounterNumber}
                  </Link>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </section>

          <Separator />

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">
              Datos del fallecimiento
            </h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">
                  Fecha y hora del fallecimiento:{" "}
                </span>
                <strong>{fmtDateTime(cert.occurredAt)}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Modo: </span>
                {manner ? (
                  <Badge variant="outline">{MANNER_LABEL[manner]}</Badge>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </section>

          <Separator />

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">
              Cadena causal (CIE-10)
            </h2>
            <CauseRow
              label="Causa básica"
              code={cert.basicCauseCode}
              desc={cert.basicCauseDesc}
            />
            <CauseRow
              label="Causa intermedia"
              code={cert.intermediateCauseCode}
              desc={cert.intermediateCauseDesc}
            />
            <CauseRow
              label="Causa directa"
              code={cert.directCauseCode}
              desc={cert.directCauseDesc}
            />
            {cert.contributingCauses ? (
              <div className="mt-3">
                <span className="text-sm text-muted-foreground">
                  Causas contribuyentes:
                </span>
                <p className="whitespace-pre-wrap text-sm">
                  {cert.contributingCauses}
                </p>
              </div>
            ) : null}
            {cert.notes ? (
              <div className="mt-3">
                <span className="text-sm text-muted-foreground">Notas:</span>
                <p className="whitespace-pre-wrap text-sm">{cert.notes}</p>
              </div>
            ) : null}
          </section>

          <Separator />

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">
              Certificación médica
            </h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">
                  Médico certificante (ID):{" "}
                </span>
                <span className="font-mono text-xs">{cert.certifiedById}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Certificado el: </span>
                <strong>{fmtDateTime(cert.certifiedAt)}</strong>
              </div>
            </div>
          </section>

          <Separator />

          <section className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-muted-foreground">Registro Civil: </span>
              {cert.notifiedToCivilRegistryAt ? (
                <Badge variant="success">
                  Notificado el{" "}
                  {fmtDateTime(cert.notifiedToCivilRegistryAt)}
                </Badge>
              ) : (
                <Badge variant="outline">Pendiente de notificar</Badge>
              )}
            </div>
            <Button
              type="button"
              variant="default"
              disabled={
                notify.isPending || Boolean(cert.notifiedToCivilRegistryAt)
              }
              onClick={() => notify.mutate({ certificateId: cert.id })}
            >
              {notify.isPending
                ? "Notificando…"
                : cert.notifiedToCivilRegistryAt
                  ? "Ya notificado"
                  : "Notificar Registro Civil"}
            </Button>
          </section>
          {notify.error ? (
            <p className="text-sm text-destructive">{notify.error.message}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Notificación al Registro Civil: stub MVP. La integración con el
            servicio del RNPN está planificada para Sprint 6.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
