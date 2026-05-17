"use client";

/**
 * ECE — Detalle de Valoración Inicial de Enfermería (read-only post-firma).
 *
 * Muestra todos los campos de la valoración. Si está en borrador, permite
 * firmarlo. Si está firmado, permite validarlo. Post-validado: solo lectura.
 *
 * Rol habilitado: NURSE.
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dtFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

function fmt(v: Date | string | null | undefined): string {
  if (!v) return "—";
  try {
    return dtFmt.format(new Date(v as string));
  } catch {
    return "—";
  }
}

function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    borrador:  { label: "Borrador",  variant: "secondary" },
    firmado:   { label: "Firmado",   variant: "default" },
    validado:  { label: "Validado",  variant: "default" },
    anulado:   { label: "Anulado",   variant: "destructive" },
  };
  const cfg = map[estado] ?? { label: estado, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-2 border-b last:border-b-0">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="col-span-2 text-sm">{value ?? "—"}</dd>
    </div>
  );
}

function ScaleDisplay({
  label,
  value,
  min,
  max,
  riskLabel,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  riskLabel: string;
}) {
  if (value === null) {
    return <Row label={label} value="No evaluado" />;
  }
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="py-2 border-b last:border-b-0">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {value} / {max}
        </span>
      </div>
      <div
        className="mt-1 h-2 rounded-full bg-muted overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{riskLabel}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ValoracionInicialDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const query = trpc.eceValoracionInicial.get.useQuery({ id });

  const firmarMutation = trpc.eceValoracionInicial.firmar.useMutation({
    onSuccess: () => void query.refetch(),
  });
  const validarMutation = trpc.eceValoracionInicial.validar.useMutation({
    onSuccess: () => void query.refetch(),
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (query.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error.message}
      </p>
    );
  }

  if (!query.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Valoración no encontrada.
      </p>
    );
  }

  const v = query.data;
  const canFirmar = v.estado_registro === "borrador";
  const canValidar = v.estado_registro === "firmado";
  const isBusy = firmarMutation.isPending || validarMutation.isPending;

  const firmarError =
    firmarMutation.error?.message ?? validarMutation.error?.message ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Valoración Inicial de Enfermería</h1>
          <p className="text-sm text-muted-foreground font-mono text-xs">
            {v.id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <EstadoBadge estado={v.estado_registro} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.back()}
          >
            Volver
          </Button>
        </div>
      </div>

      {/* Acciones de workflow */}
      {(canFirmar || canValidar) && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              {canFirmar && (
                <Button
                  type="button"
                  onClick={() => firmarMutation.mutate({ id })}
                  disabled={isBusy}
                >
                  {firmarMutation.isPending ? "Firmando…" : "Firmar valoración"}
                </Button>
              )}
              {canValidar && (
                <Button
                  type="button"
                  onClick={() => validarMutation.mutate({ id })}
                  disabled={isBusy}
                >
                  {validarMutation.isPending ? "Validando…" : "Validar valoración"}
                </Button>
              )}
              {firmarError && (
                <p role="alert" className="text-sm text-destructive">
                  {firmarError}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Datos generales */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos generales</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row
              label="Episodio hospitalario"
              value={
                <span className="font-mono text-xs">
                  {v.episodio_hospitalario_id}
                </span>
              }
            />
            <Row label="Fecha / Hora valoración" value={fmt(v.fecha_hora)} />
            <Row label="Registrado en" value={fmt(v.registrado_en)} />
            {v.firmado_en && <Row label="Firmado en" value={fmt(v.firmado_en)} />}
            {v.validado_en && <Row label="Validado en" value={fmt(v.validado_en)} />}
          </dl>
        </CardContent>
      </Card>

      {/* Antecedentes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Antecedentes</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label="Personales" value={v.antecedentes_personales} />
            <Row label="Familiares" value={v.antecedentes_familiares} />
            <Row label="Alergias conocidas" value={v.alergias_conocidas} />
            <Row label="Medicamentos actuales" value={v.medicamentos_actuales} />
          </dl>
        </CardContent>
      </Card>

      {/* Escalas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Escalas clínicas</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <ScaleDisplay
              label="Escala Braden (úlcera por presión)"
              value={v.escala_braden}
              min={6}
              max={23}
              riskLabel="6 = riesgo muy alto · 23 = sin riesgo"
            />
            <ScaleDisplay
              label="Escala Morse (caídas)"
              value={v.escala_morse}
              min={0}
              max={125}
              riskLabel="0 = sin riesgo · ≥45 = alto riesgo"
            />
            <ScaleDisplay
              label="Dolor EVA"
              value={v.escala_dolor}
              min={0}
              max={10}
              riskLabel="0 = sin dolor · 10 = dolor máximo"
            />
          </dl>
        </CardContent>
      </Card>

      {/* Estado actual */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estado actual al ingreso</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label="Estado de consciencia" value={v.estado_consciencia} />
            <Row label="Dispositivos invasivos" value={v.dispositivos_invasivos} />
          </dl>
        </CardContent>
      </Card>

      {/* Plan inicial */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan inicial</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label="Educación brindada" value={v.educacion_brindada} />
            <Row label="Plan de cuidados inicial" value={v.plan_cuidados_inicial} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
