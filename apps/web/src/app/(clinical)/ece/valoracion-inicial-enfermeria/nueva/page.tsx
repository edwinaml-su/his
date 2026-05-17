"use client";

/**
 * ECE — Nueva Valoración Inicial de Enfermería.
 *
 * Formulario agrupado por secciones:
 *   1. Antecedentes (personales / familiares / alergias / medicamentos)
 *   2. Escalas (Braden, Morse, Dolor con slider)
 *   3. Estado actual (consciencia, dispositivos invasivos)
 *   4. Plan inicial (educación brindada, plan de cuidados)
 *
 * Rol habilitado: NURSE.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos del formulario
// ---------------------------------------------------------------------------

interface FormState {
  episodioHospitalarioId: string;
  antecedentesPersonales: string;
  antecedentesFamiliares: string;
  alergiasConocidas: string;
  medicamentosActuales: string;
  escalaBraden: string;
  escalaMorse: string;
  escalaDolor: string;
  estadoConsciencia: string;
  dispositivosInvasivos: string;
  educacionBrindada: string;
  planCuidadosInicial: string;
}

const INITIAL_FORM: FormState = {
  episodioHospitalarioId: "",
  antecedentesPersonales: "",
  antecedentesFamiliares: "",
  alergiasConocidas: "",
  medicamentosActuales: "",
  escalaBraden: "",
  escalaMorse: "",
  escalaDolor: "",
  estadoConsciencia: "",
  dispositivosInvasivos: "",
  educacionBrindada: "",
  planCuidadosInicial: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIntOrUndefined(v: string): number | undefined {
  if (v === "") return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

function validate(f: FormState): string | null {
  if (!f.episodioHospitalarioId.trim()) {
    return "El UUID del episodio hospitalario es requerido.";
  }
  if (!/^[0-9a-f-]{36}$/i.test(f.episodioHospitalarioId.trim())) {
    return "El UUID del episodio hospitalario no tiene formato válido.";
  }
  const braden = toIntOrUndefined(f.escalaBraden);
  if (braden !== undefined && (braden < 6 || braden > 23)) {
    return "Escala Braden debe estar entre 6 y 23.";
  }
  const morse = toIntOrUndefined(f.escalaMorse);
  if (morse !== undefined && (morse < 0 || morse > 125)) {
    return "Escala Morse debe estar entre 0 y 125.";
  }
  const dolor = toIntOrUndefined(f.escalaDolor);
  if (dolor !== undefined && (dolor < 0 || dolor > 10)) {
    return "Escala de dolor debe estar entre 0 y 10.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function TextareaField({
  id,
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ScaleSlider({
  id,
  label,
  value,
  min,
  max,
  onChange,
  description,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  onChange: (v: string) => void;
  description: string;
}) {
  const numVal = value === "" ? undefined : parseInt(value, 10);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-sm font-medium tabular-nums">
          {numVal !== undefined && !isNaN(numVal) ? numVal : "—"}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={numVal ?? min}
        onChange={(e) => onChange(e.target.value)}
        className="h-2 w-full cursor-pointer accent-primary"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={numVal ?? min}
        aria-label={label}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}</span>
        <span className="text-center text-xs">{description}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NuevaValoracionInicialPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const createMutation = trpc.eceValoracionInicial.create.useMutation({
    onSuccess: (data) => {
      router.push(`/ece/valoracion-inicial-enfermeria/${data.id}`);
    },
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    createMutation.mutate({
      episodioHospitalarioId: form.episodioHospitalarioId.trim(),
      fechaHora: new Date(),
      antecedentesPersonales: form.antecedentesPersonales || undefined,
      antecedentesFamiliares: form.antecedentesFamiliares || undefined,
      alergiasConocidas: form.alergiasConocidas || undefined,
      medicamentosActuales: form.medicamentosActuales || undefined,
      escalaBraden: toIntOrUndefined(form.escalaBraden),
      escalaMorse: toIntOrUndefined(form.escalaMorse),
      escalaDolor: toIntOrUndefined(form.escalaDolor),
      estadoConsciencia: form.estadoConsciencia || undefined,
      dispositivosInvasivos: form.dispositivosInvasivos || undefined,
      educacionBrindada: form.educacionBrindada || undefined,
      planCuidadosInicial: form.planCuidadosInicial || undefined,
    });
  }

  const errorMsg = clientError ?? createMutation.error?.message ?? null;
  const isSubmitting = createMutation.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva Valoración Inicial de Enfermería</h1>
        <p className="text-sm text-muted-foreground">
          Registro de ingreso hospitalario — NTEC §4. Quedará en estado Borrador
          hasta la firma.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {/* Episodio */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-1.5">
              <Label htmlFor="episodio-id">UUID del episodio hospitalario *</Label>
              <Input
                id="episodio-id"
                required
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={form.episodioHospitalarioId}
                onChange={(e) => update("episodioHospitalarioId", e.target.value)}
                className="font-mono text-sm"
                aria-describedby="episodio-id-hint"
              />
              <p id="episodio-id-hint" className="text-xs text-muted-foreground">
                UUID del episodio hospitalario activo del paciente.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sección 1: Antecedentes */}
        <SectionCard title="1. Antecedentes">
          <TextareaField
            id="antec-personales"
            label="Antecedentes personales"
            value={form.antecedentesPersonales}
            onChange={(v) => update("antecedentesPersonales", v)}
            hint="Enfermedades previas, cirugías, hospitalizaciones."
          />
          <TextareaField
            id="antec-familiares"
            label="Antecedentes familiares"
            value={form.antecedentesFamiliares}
            onChange={(v) => update("antecedentesFamiliares", v)}
          />
          <TextareaField
            id="alergias"
            label="Alergias conocidas"
            value={form.alergiasConocidas}
            onChange={(v) => update("alergiasConocidas", v)}
            rows={2}
            hint="Medicamentos, alimentos, látex, etc."
          />
          <TextareaField
            id="medicamentos"
            label="Medicamentos actuales"
            value={form.medicamentosActuales}
            onChange={(v) => update("medicamentosActuales", v)}
            rows={2}
            hint="Listado de medicamentos que toma el paciente al ingreso."
          />
        </SectionCard>

        {/* Sección 2: Escalas */}
        <SectionCard title="2. Escalas clínicas">
          <ScaleSlider
            id="escala-braden"
            label="Escala Braden (riesgo úlcera por presión)"
            min={6}
            max={23}
            value={form.escalaBraden}
            onChange={(v) => update("escalaBraden", v)}
            description="6 = riesgo muy alto · 23 = sin riesgo"
          />
          <ScaleSlider
            id="escala-morse"
            label="Escala Morse (riesgo de caídas)"
            min={0}
            max={125}
            value={form.escalaMorse}
            onChange={(v) => update("escalaMorse", v)}
            description="0 = sin riesgo · ≥45 = alto riesgo"
          />
          <ScaleSlider
            id="escala-dolor"
            label="Escala de dolor EVA"
            min={0}
            max={10}
            value={form.escalaDolor}
            onChange={(v) => update("escalaDolor", v)}
            description="0 = sin dolor · 10 = dolor máximo"
          />
        </SectionCard>

        {/* Sección 3: Estado actual */}
        <SectionCard title="3. Estado actual al ingreso">
          <TextareaField
            id="estado-consciencia"
            label="Estado de consciencia"
            value={form.estadoConsciencia}
            onChange={(v) => update("estadoConsciencia", v)}
            rows={2}
            hint="Glasgow, orientación, nivel de alerta."
          />
          <TextareaField
            id="dispositivos"
            label="Dispositivos invasivos"
            value={form.dispositivosInvasivos}
            onChange={(v) => update("dispositivosInvasivos", v)}
            rows={2}
            hint="Catéter venoso, SNG, sonda vesical, etc."
          />
        </SectionCard>

        {/* Sección 4: Plan inicial */}
        <SectionCard title="4. Plan inicial">
          <TextareaField
            id="educacion"
            label="Educación brindada al paciente / familiar"
            value={form.educacionBrindada}
            onChange={(v) => update("educacionBrindada", v)}
            rows={3}
          />
          <TextareaField
            id="plan-cuidados"
            label="Plan de cuidados inicial"
            value={form.planCuidadosInicial}
            onChange={(v) => update("planCuidadosInicial", v)}
            rows={4}
            hint="Intervenciones de enfermería planificadas para el ingreso."
          />
        </SectionCard>

        {errorMsg && (
          <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
            {errorMsg}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : "Guardar borrador"}
          </Button>
        </div>
      </form>
    </div>
  );
}
