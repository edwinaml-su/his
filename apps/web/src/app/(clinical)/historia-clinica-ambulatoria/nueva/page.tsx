"use client";

/**
 * Historia Clínica Ambulatoria — Formulario de creación.
 *
 * Campos NTEC Art. 7 para consulta ambulatoria:
 *   pacienteId, motivoConsulta, anamnesis, antecedentes
 *   (familiares/personales/ginecológicos), examenFisico,
 *   diagnosticos CIE-10, planTerapeutico.
 *
 * TODO(HC-002): usar tipo nativo cuando el router `eceHistoriaClinica`
 * esté mergeado. Cast `(trpc as any)` es temporal.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Form, FormField, FormHint } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

// ── Constantes ────────────────────────────────────────────────────────────────

const DISPOSICION_OPTIONS = [
  { value: "ALTA", label: "Alta" },
  { value: "INTERNAMIENTO", label: "Internamiento" },
  { value: "REFERENCIA", label: "Referencia" },
  { value: "OBSERVACION", label: "Observación" },
] as const;

/** Regex CIE-10: letra mayúscula + 2 dígitos + subcodigo opcional */
const CIE10_REGEX = /^[A-Z]\d{2}(\.\d+)?$/;

const TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

// ── Tipos locales ─────────────────────────────────────────────────────────────

interface DiagnosticoCie10 {
  code: string;
  description: string;
  tipo: "principal" | "secundario";
}

interface FormState {
  pacienteId: string;
  motivoConsulta: string;
  anamnesis: string;
  antecedentesPersonales: string;
  antecedentesFamiliares: string;
  antecedentesGineco: string;
  examenFisico: string;
  planTerapeutico: string;
  disposicion: string;
}

const INITIAL: FormState = {
  pacienteId: "",
  motivoConsulta: "",
  anamnesis: "",
  antecedentesPersonales: "",
  antecedentesFamiliares: "",
  antecedentesGineco: "",
  examenFisico: "",
  planTerapeutico: "",
  disposicion: "",
};

const INITIAL_DX: DiagnosticoCie10 = { code: "", description: "", tipo: "secundario" };

// ── Validación inline ─────────────────────────────────────────────────────────

function validate(form: FormState, dx: DiagnosticoCie10[]): string | null {
  if (!form.pacienteId.trim()) return "El ID del paciente es requerido.";
  if (!form.motivoConsulta.trim()) return "El motivo de consulta es requerido.";
  for (const d of dx) {
    if (!CIE10_REGEX.test(d.code)) {
      return `Código CIE-10 inválido: '${d.code}'. Formato: letra + 2 dígitos (ej. J00, I10.0).`;
    }
  }
  return null;
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function NuevaHistoriaClinicaAmbulatoriaPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [diagnosticos, setDiagnosticos] = React.useState<DiagnosticoCie10[]>([]);
  const [dxInput, setDxInput] = React.useState<DiagnosticoCie10>(INITIAL_DX);
  const [clientError, setClientError] = React.useState<string | null>(null);

  // TODO(HC-002): reemplazar cast cuando el router esté disponible.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const create = (trpc as any).eceHistoriaClinica.create.useMutation({
    onSuccess: () => {
      router.push("/historia-clinica-ambulatoria");
    },
  }) as {
    mutate: (input: Record<string, unknown>) => void;
    isPending: boolean;
    error: { message: string } | null;
  };

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addDiagnostico() {
    const code = dxInput.code.trim().toUpperCase();
    if (!code || !dxInput.description.trim()) return;
    if (!CIE10_REGEX.test(code)) {
      setClientError(`Código CIE-10 inválido: '${code}'. Ejemplo: J00, I10.0`);
      return;
    }
    setClientError(null);
    setDiagnosticos((prev) => [...prev, { ...dxInput, code }]);
    setDxInput(INITIAL_DX);
  }

  function removeDiagnostico(index: number) {
    setDiagnosticos((prev) => prev.filter((_, i) => i !== index));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form, diagnosticos);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);

    const antecedentes =
      form.antecedentesPersonales || form.antecedentesFamiliares || form.antecedentesGineco
        ? {
            personales: form.antecedentesPersonales.trim() || undefined,
            familiares: form.antecedentesFamiliares.trim() || undefined,
            ginecologicos: form.antecedentesGineco.trim() || undefined,
          }
        : undefined;

    create.mutate({
      pacienteId: form.pacienteId.trim(),
      // tipoConsulta fijo en "ambulatoria" para este módulo (NTEC Art. 7)
      tipoConsulta: "ambulatoria",
      motivoConsulta: form.motivoConsulta.trim(),
      // anamnesis mapea a enfermedadActual en el schema de BD
      enfermedadActual: form.anamnesis.trim() || undefined,
      antecedentes,
      examenFisico: form.examenFisico.trim()
        ? { sistemas: [{ sistema: "General", hallazgo: form.examenFisico.trim() }] }
        : undefined,
      diagnosticos: diagnosticos.length > 0 ? diagnosticos : undefined,
      // planTerapeutico mapea a planManejo en el schema de BD
      planManejo: form.planTerapeutico.trim() || undefined,
      disposicion:
        (form.disposicion as "ALTA" | "INTERNAMIENTO" | "REFERENCIA" | "OBSERVACION") ||
        undefined,
    });
  }

  const isSubmitting = create.isPending;
  const errorMessage = clientError ?? create.error?.message ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva Historia Clínica Ambulatoria</h1>
        <p className="text-sm text-muted-foreground">
          Consulta ambulatoria NTEC Art. 7 — se guardará como borrador hasta ser firmada.
        </p>
      </div>

      <Form onSubmit={onSubmit} noValidate aria-label="Formulario nueva historia clínica ambulatoria">

        {/* ── 1. Identificación del paciente ────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Paciente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField>
              <Label htmlFor="pacienteId">
                ID del paciente{" "}
                <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Input
                id="pacienteId"
                name="pacienteId"
                required
                aria-required="true"
                placeholder="UUID del paciente"
                value={form.pacienteId}
                onChange={(e) => updateField("pacienteId", e.target.value)}
                disabled={isSubmitting}
              />
              <FormHint>UUID del registro de paciente en el sistema.</FormHint>
            </FormField>

            <FormField>
              <Label htmlFor="motivoConsulta">
                Motivo de consulta{" "}
                <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <textarea
                id="motivoConsulta"
                name="motivoConsulta"
                rows={3}
                required
                aria-required="true"
                placeholder="Motivo principal por el que consulta el paciente…"
                value={form.motivoConsulta}
                onChange={(e) => updateField("motivoConsulta", e.target.value)}
                disabled={isSubmitting}
                className={TEXTAREA_CLASS}
              />
            </FormField>

            <FormField>
              <Label htmlFor="anamnesis">Anamnesis</Label>
              <textarea
                id="anamnesis"
                name="anamnesis"
                rows={4}
                placeholder="Historia de la enfermedad actual, cronología de síntomas…"
                value={form.anamnesis}
                onChange={(e) => updateField("anamnesis", e.target.value)}
                disabled={isSubmitting}
                className={TEXTAREA_CLASS}
              />
            </FormField>
          </CardContent>
        </Card>

        {/* ── 2. Antecedentes ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Antecedentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField>
                <Label htmlFor="antecedentesPersonales">Personales</Label>
                <textarea
                  id="antecedentesPersonales"
                  name="antecedentesPersonales"
                  rows={3}
                  placeholder="Enfermedades previas, cirugías, hospitalizaciones…"
                  value={form.antecedentesPersonales}
                  onChange={(e) => updateField("antecedentesPersonales", e.target.value)}
                  disabled={isSubmitting}
                  className={TEXTAREA_CLASS}
                />
              </FormField>

              <FormField>
                <Label htmlFor="antecedentesFamiliares">Familiares</Label>
                <textarea
                  id="antecedentesFamiliares"
                  name="antecedentesFamiliares"
                  rows={3}
                  placeholder="Diabetes, HTA, cáncer, cardiopatías familiares…"
                  value={form.antecedentesFamiliares}
                  onChange={(e) => updateField("antecedentesFamiliares", e.target.value)}
                  disabled={isSubmitting}
                  className={TEXTAREA_CLASS}
                />
              </FormField>

              <FormField>
                <Label htmlFor="antecedentesGineco">Ginecológicos / obstétricos</Label>
                <textarea
                  id="antecedentesGineco"
                  name="antecedentesGineco"
                  rows={3}
                  placeholder="G/P/A/C, FUR, MAC, menopausia… (cuando aplique)"
                  value={form.antecedentesGineco}
                  onChange={(e) => updateField("antecedentesGineco", e.target.value)}
                  disabled={isSubmitting}
                  className={TEXTAREA_CLASS}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        {/* ── 3. Examen físico ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Examen físico</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField>
              <Label htmlFor="examenFisico">Hallazgos por aparato y sistema</Label>
              <textarea
                id="examenFisico"
                name="examenFisico"
                rows={5}
                placeholder="Cardiovascular, respiratorio, digestivo, neurológico…"
                value={form.examenFisico}
                onChange={(e) => updateField("examenFisico", e.target.value)}
                disabled={isSubmitting}
                className={TEXTAREA_CLASS}
              />
            </FormField>
          </CardContent>
        </Card>

        {/* ── 4. Diagnósticos CIE-10 ───────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnósticos (CIE-10)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset>
              <legend className="sr-only">Agregar diagnóstico CIE-10</legend>
              <div className="flex items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="dxCodigo">Código</Label>
                  <Input
                    id="dxCodigo"
                    name="dxCodigo"
                    placeholder="J18.9"
                    value={dxInput.code}
                    onChange={(e) =>
                      setDxInput((d) => ({ ...d, code: e.target.value.toUpperCase() }))
                    }
                    disabled={isSubmitting}
                    className="w-28"
                    aria-label="Código CIE-10"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="dxDescripcion">Descripción</Label>
                  <Input
                    id="dxDescripcion"
                    name="dxDescripcion"
                    placeholder="Descripción del diagnóstico…"
                    value={dxInput.description}
                    onChange={(e) =>
                      setDxInput((d) => ({ ...d, description: e.target.value }))
                    }
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dxTipo">Tipo</Label>
                  <Select
                    value={dxInput.tipo}
                    onValueChange={(v) =>
                      setDxInput((d) => ({ ...d, tipo: v as "principal" | "secundario" }))
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id="dxTipo" className="w-36" aria-label="Tipo de diagnóstico">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="principal">Principal</SelectItem>
                      <SelectItem value="secundario">Secundario</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addDiagnostico}
                  disabled={isSubmitting || !dxInput.code.trim() || !dxInput.description.trim()}
                  aria-label="Agregar diagnóstico a la lista"
                >
                  Agregar
                </Button>
              </div>
            </fieldset>
            <FormHint>
              Formato CIE-10: letra mayúscula + 2 dígitos (ej. J00, I10.0, K29.7).
            </FormHint>

            {diagnosticos.length > 0 && (
              <ul
                className="divide-y rounded-md border"
                aria-label="Diagnósticos agregados"
              >
                {diagnosticos.map((dx, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {dx.code}
                      </span>
                      {dx.description}
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({dx.tipo})
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDiagnostico(i)}
                      disabled={isSubmitting}
                      aria-label={`Eliminar diagnóstico ${dx.code}`}
                    >
                      Eliminar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── 5. Plan terapéutico y disposición ───────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Plan terapéutico y disposición</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField>
              <Label htmlFor="planTerapeutico">Plan terapéutico</Label>
              <textarea
                id="planTerapeutico"
                name="planTerapeutico"
                rows={5}
                placeholder="Medicamentos, dosis, indicaciones, controles, derivaciones…"
                value={form.planTerapeutico}
                onChange={(e) => updateField("planTerapeutico", e.target.value)}
                disabled={isSubmitting}
                className={TEXTAREA_CLASS}
              />
            </FormField>

            <FormField>
              <Label htmlFor="disposicion">Disposición del paciente</Label>
              <Select
                value={form.disposicion}
                onValueChange={(v) => updateField("disposicion", v)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="disposicion" aria-label="Disposición del paciente al alta">
                  <SelectValue placeholder="Seleccione disposición" />
                </SelectTrigger>
                <SelectContent>
                  {DISPOSICION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </CardContent>
        </Card>

        {/* ── Error + Acciones ──────────────────────────────────────────────── */}
        {errorMessage && (
          <p
            role="alert"
            aria-live="polite"
            className="text-sm font-medium text-destructive"
          >
            {errorMessage}
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
          <Button
            type="submit"
            disabled={isSubmitting}
            aria-label="Guardar historia clínica ambulatoria como borrador"
          >
            {isSubmitting ? "Guardando…" : "Guardar borrador"}
          </Button>
        </div>
      </Form>
    </div>
  );
}
