"use client";

/**
 * Historia Clínica Ambulatoria — Formulario de creación.
 *
 * Campos NTEC Art. 7 para consulta ambulatoria:
 *   episodioId, motivoConsulta, anamnesis, antecedentes
 *   (familiares/personales/ginecológicos), examenFisico,
 *   diagnosticos CIE-10, planTerapeutico.
 *
 * El router `eceHistoriaClinica.create` es episode-centric: requiere
 * episodioId (no pacienteId) — ver `packages/trpc/src/routers/ece/historia-clinica.router.ts`.
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
import {
  CIE11_CODE_REGEX,
  DESTINO_LABELS,
  DESTINO_OPTIONS,
  TIPO_DIAGNOSTICO_LABELS,
  TIPO_DIAGNOSTICO,
} from "@his/contracts";
import { trpc } from "@/lib/trpc/react";

const TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

// ── Tipos locales ─────────────────────────────────────────────────────────────

interface DiagnosticoCie11 {
  codigo: string;
  descripcion: string;
  tipo: (typeof TIPO_DIAGNOSTICO)[number];
}

interface FormState {
  episodioId: string;
  motivoConsulta: string;
  anamnesis: string;
  antecedentesPersonales: string;
  antecedentesFamiliares: string;
  antecedentesGineco: string;
  examenFisico: string;
  planTerapeutico: string;
  destino: string;
}

const INITIAL: FormState = {
  episodioId: "",
  motivoConsulta: "",
  anamnesis: "",
  antecedentesPersonales: "",
  antecedentesFamiliares: "",
  antecedentesGineco: "",
  examenFisico: "",
  planTerapeutico: "",
  destino: "",
};

const INITIAL_DX: DiagnosticoCie11 = { codigo: "", descripcion: "", tipo: "COMPLEMENTARIO" };

// ── Validación inline ─────────────────────────────────────────────────────────

function validate(form: FormState, dx: DiagnosticoCie11[]): string | null {
  if (!form.episodioId.trim()) return "El ID del episodio es requerido.";
  if (!form.motivoConsulta.trim()) return "El motivo de consulta es requerido.";
  for (const d of dx) {
    if (!CIE11_CODE_REGEX.test(d.codigo)) {
      return `Código CIE-11 inválido: '${d.codigo}'.`;
    }
  }
  return null;
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function NuevaHistoriaClinicaAmbulatoriaPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [diagnosticos, setDiagnosticos] = React.useState<DiagnosticoCie11[]>([]);
  const [dxInput, setDxInput] = React.useState<DiagnosticoCie11>(INITIAL_DX);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.eceHistoriaClinica.create.useMutation({
    onSuccess: () => {
      router.push("/historia-clinica-ambulatoria");
    },
  });

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addDiagnostico() {
    const codigo = dxInput.codigo.trim().toUpperCase();
    if (!codigo || !dxInput.descripcion.trim()) return;
    if (!CIE11_CODE_REGEX.test(codigo)) {
      setClientError(`Código CIE-11 inválido: '${codigo}'.`);
      return;
    }
    setClientError(null);
    setDiagnosticos((prev) => [...prev, { ...dxInput, codigo }]);
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
            obstetricos: form.antecedentesGineco.trim() || undefined,
          }
        : undefined;

    create.mutate({
      episodioId: form.episodioId.trim(),
      // tipoConsulta se omite: el server lo deriva ('primera_vez'/'subsecuente'
      // según historial del paciente) — ver eceHistoriaClinica.create.
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
      destino: (form.destino as (typeof DESTINO_OPTIONS)[number]) || undefined,
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
              <Label htmlFor="episodioId">
                ID del episodio{" "}
                <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Input
                id="episodioId"
                name="episodioId"
                required
                aria-required="true"
                placeholder="UUID del episodio de atención"
                value={form.episodioId}
                onChange={(e) => updateField("episodioId", e.target.value)}
                disabled={isSubmitting}
              />
              <FormHint>UUID del episodio de atención del paciente.</FormHint>
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
              <legend className="sr-only">Agregar diagnóstico CIE-11</legend>
              <div className="flex items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="dxCodigo">Código</Label>
                  <Input
                    id="dxCodigo"
                    name="dxCodigo"
                    placeholder="1A00"
                    value={dxInput.codigo}
                    onChange={(e) =>
                      setDxInput((d) => ({ ...d, codigo: e.target.value.toUpperCase() }))
                    }
                    disabled={isSubmitting}
                    className="w-28"
                    aria-label="Código CIE-11"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="dxDescripcion">Descripción</Label>
                  <Input
                    id="dxDescripcion"
                    name="dxDescripcion"
                    placeholder="Descripción del diagnóstico…"
                    value={dxInput.descripcion}
                    onChange={(e) =>
                      setDxInput((d) => ({ ...d, descripcion: e.target.value }))
                    }
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dxTipo">Tipo</Label>
                  <Select
                    value={dxInput.tipo}
                    onValueChange={(v) =>
                      setDxInput((d) => ({ ...d, tipo: v as DiagnosticoCie11["tipo"] }))
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id="dxTipo" className="w-40" aria-label="Tipo de diagnóstico">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPO_DIAGNOSTICO.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TIPO_DIAGNOSTICO_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addDiagnostico}
                  disabled={isSubmitting || !dxInput.codigo.trim() || !dxInput.descripcion.trim()}
                  aria-label="Agregar diagnóstico a la lista"
                >
                  Agregar
                </Button>
              </div>
            </fieldset>
            <FormHint>
              Código CIE-11 (OMS): stem alfanumérico, ej. 1A00, BA00, KA62.1.
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
                        {dx.codigo}
                      </span>
                      {dx.descripcion}
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({TIPO_DIAGNOSTICO_LABELS[dx.tipo]})
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDiagnostico(i)}
                      disabled={isSubmitting}
                      aria-label={`Eliminar diagnóstico ${dx.codigo}`}
                    >
                      Eliminar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── 5. Plan terapéutico y destino ───────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Plan terapéutico y destino</CardTitle>
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
              <Label htmlFor="destino">Destino del paciente</Label>
              <Select
                value={form.destino}
                onValueChange={(v) => updateField("destino", v)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="destino" aria-label="Destino del paciente">
                  <SelectValue placeholder="Seleccione destino" />
                </SelectTrigger>
                <SelectContent>
                  {DESTINO_OPTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DESTINO_LABELS[d]}
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
