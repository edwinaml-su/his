"use client";

/**
 * §ECE — Historia Clínica Electrónica — Formulario de creación.
 *
 * Secciones:
 *   1. Datos generales: motivo consulta, antecedentes personales/familiares/sociales.
 *   2. Examen físico: signos vitales rápidos + hallazgos por aparato.
 *   3. Diagnósticos: CIE-10 multi-entrada (código + descripción, búsqueda textual).
 *   4. Plan terapéutico.
 *
 * Validación: React state + validate() antes de mutación. El router aplica
 * Zod (`eceHistoriaClinicaCreateSchema`) como defensa definitiva.
 *
 * Patrón: sigue outpatient/new — React state directa, sin RHF, coherente con
 * el resto del codebase.
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
import { trpc } from "@/lib/trpc/react";

// ── Tipos locales ─────────────────────────────────────────────────────────────

interface DiagnosticoCie10 {
  codigoCie10: string;
  descripcion: string;
}

interface SignosVitales {
  paSistolica: string;
  paDiastolica: string;
  frecuenciaCardiaca: string;
  frecuenciaRespiratoria: string;
  temperatura: string;
}

interface FormState {
  pacienteId: string;
  encounterId: string;
  motivoConsulta: string;
  antecedentesPersonales: string;
  antecedentesFamiliares: string;
  antecedentesSociales: string;
  signosVitales: SignosVitales;
  hallazgosAparato: string;
  planTerapeutico: string;
}

const INITIAL: FormState = {
  pacienteId: "",
  encounterId: "",
  motivoConsulta: "",
  antecedentesPersonales: "",
  antecedentesFamiliares: "",
  antecedentesSociales: "",
  signosVitales: {
    paSistolica: "",
    paDiastolica: "",
    frecuenciaCardiaca: "",
    frecuenciaRespiratoria: "",
    temperatura: "",
  },
  hallazgosAparato: "",
  planTerapeutico: "",
};

const INITIAL_DX: DiagnosticoCie10 = { codigoCie10: "", descripcion: "" };

// ── Validación ────────────────────────────────────────────────────────────────

function validate(form: FormState): string | null {
  if (!form.pacienteId.trim()) return "Paciente es requerido.";
  if (!form.motivoConsulta.trim()) return "Motivo de consulta es requerido.";
  return null;
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function NuevaHistoriaClinicaPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [diagnosticos, setDiagnosticos] = React.useState<DiagnosticoCie10[]>([]);
  const [dxInput, setDxInput] = React.useState<DiagnosticoCie10>(INITIAL_DX);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.eceHistoriaClinica.create.useMutation({
    onSuccess: () => {
      router.push("/ece/historia-clinica");
    },
  });

  const isSubmitting = create.isPending;

  // Actualiza campo de nivel raíz
  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Actualiza signo vital individual
  function updateVital<K extends keyof SignosVitales>(
    key: K,
    value: string,
  ) {
    setForm((f) => ({
      ...f,
      signosVitales: { ...f.signosVitales, [key]: value },
    }));
  }

  // Agrega diagnóstico a la lista
  function addDiagnostico() {
    if (!dxInput.codigoCie10.trim() || !dxInput.descripcion.trim()) return;
    setDiagnosticos((prev) => [...prev, { ...dxInput }]);
    setDxInput(INITIAL_DX);
  }

  // Elimina diagnóstico por índice
  function removeDiagnostico(index: number) {
    setDiagnosticos((prev) => prev.filter((_, i) => i !== index));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);

    // Construye payload omitiendo vacíos opcionales
    const sv = form.signosVitales;
    const signosVitalesPayload = Object.values(sv).some((v) => v.trim())
      ? {
          paSistolica: sv.paSistolica ? Number(sv.paSistolica) : undefined,
          paDiastolica: sv.paDiastolica ? Number(sv.paDiastolica) : undefined,
          frecuenciaCardiaca: sv.frecuenciaCardiaca
            ? Number(sv.frecuenciaCardiaca)
            : undefined,
          frecuenciaRespiratoria: sv.frecuenciaRespiratoria
            ? Number(sv.frecuenciaRespiratoria)
            : undefined,
          temperatura: sv.temperatura ? Number(sv.temperatura) : undefined,
        }
      : undefined;

    create.mutate({
      pacienteId: form.pacienteId.trim(),
      encounterId: form.encounterId.trim() || undefined,
      motivoConsulta: form.motivoConsulta.trim(),
      antecedentesPersonales: form.antecedentesPersonales.trim() || undefined,
      antecedentesFamiliares: form.antecedentesFamiliares.trim() || undefined,
      antecedentesSociales: form.antecedentesSociales.trim() || undefined,
      signosVitales: signosVitalesPayload,
      hallazgosAparato: form.hallazgosAparato.trim() || undefined,
      diagnosticos: diagnosticos.length > 0 ? diagnosticos : undefined,
      planTerapeutico: form.planTerapeutico.trim() || undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva Historia Clínica</h1>
        <p className="text-sm text-muted-foreground">
          Registra la Historia Clínica Electrónica del paciente (§ECE).
        </p>
      </div>

      <Form onSubmit={onSubmit} noValidate aria-label="Formulario nueva historia clínica">

        {/* ── 1. Datos generales ────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Datos generales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField>
              <Label htmlFor="pacienteId">
                Paciente (ID){" "}
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
              <FormHint>
                TODO: autocomplete con búsqueda de pacientes (Sprint próximo).
              </FormHint>
            </FormField>

            <FormField>
              <Label htmlFor="encounterId">Encuentro / visita (ID)</Label>
              <Input
                id="encounterId"
                name="encounterId"
                placeholder="UUID del encuentro (opcional)"
                value={form.encounterId}
                onChange={(e) => updateField("encounterId", e.target.value)}
                disabled={isSubmitting}
              />
            </FormField>

            <FormField>
              <Label htmlFor="motivoConsulta">
                Motivo de consulta{" "}
                <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <textarea
                id="motivoConsulta"
                name="motivoConsulta"
                required
                aria-required="true"
                rows={3}
                placeholder="Describa el motivo principal de la consulta"
                value={form.motivoConsulta}
                onChange={(e) => updateField("motivoConsulta", e.target.value)}
                disabled={isSubmitting}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField>
                <Label htmlFor="antecedentesPersonales">
                  Antecedentes personales
                </Label>
                <textarea
                  id="antecedentesPersonales"
                  name="antecedentesPersonales"
                  rows={4}
                  placeholder="Enfermedades previas, cirugías, alergias…"
                  value={form.antecedentesPersonales}
                  onChange={(e) =>
                    updateField("antecedentesPersonales", e.target.value)
                  }
                  disabled={isSubmitting}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </FormField>

              <FormField>
                <Label htmlFor="antecedentesFamiliares">
                  Antecedentes familiares
                </Label>
                <textarea
                  id="antecedentesFamiliares"
                  name="antecedentesFamiliares"
                  rows={4}
                  placeholder="Diabetes, HTA, cáncer familiar…"
                  value={form.antecedentesFamiliares}
                  onChange={(e) =>
                    updateField("antecedentesFamiliares", e.target.value)
                  }
                  disabled={isSubmitting}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </FormField>

              <FormField>
                <Label htmlFor="antecedentesSociales">
                  Antecedentes sociales
                </Label>
                <textarea
                  id="antecedentesSociales"
                  name="antecedentesSociales"
                  rows={4}
                  placeholder="Hábitos, ocupación, tabaquismo…"
                  value={form.antecedentesSociales}
                  onChange={(e) =>
                    updateField("antecedentesSociales", e.target.value)
                  }
                  disabled={isSubmitting}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        {/* ── 2. Examen físico ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Examen físico</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                Signos vitales
              </legend>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <div className="space-y-1.5">
                  <Label htmlFor="paSistolica">PA sistólica (mmHg)</Label>
                  <Input
                    id="paSistolica"
                    name="paSistolica"
                    type="number"
                    min={50}
                    max={300}
                    placeholder="120"
                    value={form.signosVitales.paSistolica}
                    onChange={(e) => updateVital("paSistolica", e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="paDiastolica">PA diastólica (mmHg)</Label>
                  <Input
                    id="paDiastolica"
                    name="paDiastolica"
                    type="number"
                    min={30}
                    max={200}
                    placeholder="80"
                    value={form.signosVitales.paDiastolica}
                    onChange={(e) =>
                      updateVital("paDiastolica", e.target.value)
                    }
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="frecuenciaCardiaca">FC (lpm)</Label>
                  <Input
                    id="frecuenciaCardiaca"
                    name="frecuenciaCardiaca"
                    type="number"
                    min={20}
                    max={300}
                    placeholder="72"
                    value={form.signosVitales.frecuenciaCardiaca}
                    onChange={(e) =>
                      updateVital("frecuenciaCardiaca", e.target.value)
                    }
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="frecuenciaRespiratoria">FR (rpm)</Label>
                  <Input
                    id="frecuenciaRespiratoria"
                    name="frecuenciaRespiratoria"
                    type="number"
                    min={4}
                    max={60}
                    placeholder="16"
                    value={form.signosVitales.frecuenciaRespiratoria}
                    onChange={(e) =>
                      updateVital("frecuenciaRespiratoria", e.target.value)
                    }
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="temperatura">Temperatura (°C)</Label>
                  <Input
                    id="temperatura"
                    name="temperatura"
                    type="number"
                    min={30}
                    max={45}
                    step={0.1}
                    placeholder="36.5"
                    value={form.signosVitales.temperatura}
                    onChange={(e) => updateVital("temperatura", e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </fieldset>

            <FormField>
              <Label htmlFor="hallazgosAparato">Hallazgos por aparato</Label>
              <textarea
                id="hallazgosAparato"
                name="hallazgosAparato"
                rows={5}
                placeholder="Cardiovascular, respiratorio, digestivo, neurológico…"
                value={form.hallazgosAparato}
                onChange={(e) => updateField("hallazgosAparato", e.target.value)}
                disabled={isSubmitting}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </FormField>
          </CardContent>
        </Card>

        {/* ── 3. Diagnósticos CIE-10 ────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnósticos (CIE-10)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Entrada de nuevo diagnóstico */}
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="dxCodigo">Código CIE-10</Label>
                <Input
                  id="dxCodigo"
                  name="dxCodigo"
                  placeholder="Ej. J18.9"
                  value={dxInput.codigoCie10}
                  onChange={(e) =>
                    setDxInput((d) => ({
                      ...d,
                      codigoCie10: e.target.value.toUpperCase(),
                    }))
                  }
                  disabled={isSubmitting}
                  className="w-32"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="dxDescripcion">Descripción</Label>
                <Input
                  id="dxDescripcion"
                  name="dxDescripcion"
                  placeholder="Neumonía no especificada…"
                  value={dxInput.descripcion}
                  onChange={(e) =>
                    setDxInput((d) => ({ ...d, descripcion: e.target.value }))
                  }
                  disabled={isSubmitting}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addDiagnostico}
                disabled={
                  isSubmitting ||
                  !dxInput.codigoCie10.trim() ||
                  !dxInput.descripcion.trim()
                }
                aria-label="Agregar diagnóstico a la lista"
              >
                Agregar
              </Button>
            </div>
            <FormHint>
              Ingrese código y descripción, luego pulse Agregar. Puede
              agregar múltiples diagnósticos.
            </FormHint>

            {/* Lista de diagnósticos agregados */}
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
                        {dx.codigoCie10}
                      </span>
                      {dx.descripcion}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDiagnostico(i)}
                      disabled={isSubmitting}
                      aria-label={`Eliminar diagnóstico ${dx.codigoCie10}`}
                    >
                      Eliminar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── 4. Plan terapéutico ───────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Plan terapéutico</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField>
              <Label htmlFor="planTerapeutico">Plan</Label>
              <textarea
                id="planTerapeutico"
                name="planTerapeutico"
                rows={5}
                placeholder="Medicamentos, procedimientos, indicaciones, seguimiento…"
                value={form.planTerapeutico}
                onChange={(e) =>
                  updateField("planTerapeutico", e.target.value)
                }
                disabled={isSubmitting}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
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
            aria-label="Cancelar y volver"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            aria-label="Guardar historia clínica como borrador"
          >
            {isSubmitting ? "Guardando…" : "Guardar borrador"}
          </Button>
        </div>
      </Form>
    </div>
  );
}
