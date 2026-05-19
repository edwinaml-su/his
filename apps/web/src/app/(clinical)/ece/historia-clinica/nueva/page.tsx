"use client";

/**
 * §ECE — Historia Clínica Electrónica — Formulario de creación.
 *
 * HC-001: cubre la ausencia total de UI para crear historia clínica.
 * Campos NTEC Art. 7:
 *   - episodioId (FK obligatorio)
 *   - tipoConsulta (ingreso/control/urgencia/ambulatoria/interconsulta)
 *   - motivoConsulta, enfermedadActual
 *   - antecedentes (estructurado: personales/familiares/sociales/alergias)
 *   - examenFisico (sistemas + signos vitales)
 *   - diagnosticos CIE-10 (HC-004: validados en borde UI antes de enviar)
 *   - planManejo, disposicion
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

const TIPO_CONSULTA_OPTIONS = [
  { value: "ingreso", label: "Ingreso hospitalario" },
  { value: "control", label: "Control" },
  { value: "urgencia", label: "Urgencia" },
  { value: "ambulatoria", label: "Consulta ambulatoria" },
  { value: "interconsulta", label: "Interconsulta" },
] as const;

const DISPOSICION_OPTIONS = [
  { value: "ALTA", label: "Alta" },
  { value: "INTERNAMIENTO", label: "Internamiento" },
  { value: "REFERENCIA", label: "Referencia" },
  { value: "OBSERVACION", label: "Observación" },
] as const;

/** Regex CIE-10: letra mayúscula + 2 dígitos + subcodigo opcional */
const CIE10_REGEX = /^[A-Z]\d{2}(\.\d+)?$/;

// ── Tipos locales ─────────────────────────────────────────────────────────────

interface DiagnosticoCie10 {
  code: string;
  description: string;
  tipo: "principal" | "secundario";
}

interface FormState {
  episodioId: string;
  tipoConsulta: string;
  motivoConsulta: string;
  enfermedadActual: string;
  antecedentesPersonales: string;
  antecedentesFamiliares: string;
  antecedentesSociales: string;
  alergias: string;
  hallazgosExamen: string;
  planManejo: string;
  disposicion: string;
}

const INITIAL: FormState = {
  episodioId: "",
  tipoConsulta: "",
  motivoConsulta: "",
  enfermedadActual: "",
  antecedentesPersonales: "",
  antecedentesFamiliares: "",
  antecedentesSociales: "",
  alergias: "",
  hallazgosExamen: "",
  planManejo: "",
  disposicion: "",
};

const INITIAL_DX: DiagnosticoCie10 = { code: "", description: "", tipo: "secundario" };

// ── Validación ────────────────────────────────────────────────────────────────

function validate(form: FormState, diagnosticos: DiagnosticoCie10[]): string | null {
  if (!form.episodioId.trim()) return "Episodio es requerido.";
  if (!form.tipoConsulta) return "Tipo de consulta es requerido.";
  for (const dx of diagnosticos) {
    if (!CIE10_REGEX.test(dx.code)) {
      return `Código CIE-10 inválido: '${dx.code}'. Formato esperado: letra + 2 dígitos (ej. J00, I10.0).`;
    }
  }
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

    create.mutate({
      episodioId: form.episodioId.trim(),
      tipoConsulta: form.tipoConsulta as "ingreso" | "control" | "urgencia" | "ambulatoria" | "interconsulta",
      motivoConsulta: form.motivoConsulta.trim() || undefined,
      enfermedadActual: form.enfermedadActual.trim() || undefined,
      disposicion: (form.disposicion as "ALTA" | "INTERNAMIENTO" | "REFERENCIA" | "OBSERVACION") || undefined,
      planManejo: form.planManejo.trim() || undefined,
      antecedentes:
        form.antecedentesPersonales || form.antecedentesFamiliares ||
        form.antecedentesSociales || form.alergias
          ? {
              personales: form.antecedentesPersonales.trim() || undefined,
              familiares: form.antecedentesFamiliares.trim() || undefined,
              sociales: form.antecedentesSociales.trim() || undefined,
              alergias: form.alergias.trim() || undefined,
            }
          : undefined,
      examenFisico: form.hallazgosExamen.trim()
        ? {
            sistemas: [{ sistema: "General", hallazgo: form.hallazgosExamen.trim() }],
          }
        : undefined,
      diagnosticos: diagnosticos.length > 0 ? diagnosticos : undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva Historia Clínica</h1>
        <p className="text-sm text-muted-foreground">
          Registra la Historia Clínica Electrónica del paciente — NTEC Art. 7.
        </p>
      </div>

      <Form onSubmit={onSubmit} noValidate aria-label="Formulario nueva historia clínica">

        {/* ── 1. Datos del episodio ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Datos del episodio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField>
              <Label htmlFor="episodioId">
                Episodio (ID){" "}
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
              <FormHint>UUID del episodio_atencion al que pertenece esta HC.</FormHint>
            </FormField>

            <FormField>
              <Label htmlFor="tipoConsulta">
                Tipo de consulta{" "}
                <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Select
                value={form.tipoConsulta}
                onValueChange={(v) => updateField("tipoConsulta", v)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="tipoConsulta" aria-required="true">
                  <SelectValue placeholder="Seleccione tipo de consulta" />
                </SelectTrigger>
                <SelectContent>
                  {TIPO_CONSULTA_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <Label htmlFor="motivoConsulta">Motivo de consulta</Label>
              <textarea
                id="motivoConsulta"
                name="motivoConsulta"
                rows={3}
                placeholder="Motivo principal de la consulta"
                value={form.motivoConsulta}
                onChange={(e) => updateField("motivoConsulta", e.target.value)}
                disabled={isSubmitting}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </FormField>

            <FormField>
              <Label htmlFor="enfermedadActual">Enfermedad actual</Label>
              <textarea
                id="enfermedadActual"
                name="enfermedadActual"
                rows={4}
                placeholder="Descripción cronológica de la enfermedad actual…"
                value={form.enfermedadActual}
                onChange={(e) => updateField("enfermedadActual", e.target.value)}
                disabled={isSubmitting}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                  placeholder="Enfermedades previas, cirugías…"
                  value={form.antecedentesPersonales}
                  onChange={(e) => updateField("antecedentesPersonales", e.target.value)}
                  disabled={isSubmitting}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </FormField>

              <FormField>
                <Label htmlFor="antecedentesFamiliares">Familiares</Label>
                <textarea
                  id="antecedentesFamiliares"
                  name="antecedentesFamiliares"
                  rows={3}
                  placeholder="Diabetes, HTA, cáncer familiar…"
                  value={form.antecedentesFamiliares}
                  onChange={(e) => updateField("antecedentesFamiliares", e.target.value)}
                  disabled={isSubmitting}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </FormField>

              <FormField>
                <Label htmlFor="antecedentesSociales">Sociales</Label>
                <textarea
                  id="antecedentesSociales"
                  name="antecedentesSociales"
                  rows={3}
                  placeholder="Hábitos, ocupación, tabaquismo…"
                  value={form.antecedentesSociales}
                  onChange={(e) => updateField("antecedentesSociales", e.target.value)}
                  disabled={isSubmitting}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </FormField>

              <FormField>
                <Label htmlFor="alergias">Alergias conocidas</Label>
                <textarea
                  id="alergias"
                  name="alergias"
                  rows={3}
                  placeholder="Medicamentos, alimentos, látex…"
                  value={form.alergias}
                  onChange={(e) => updateField("alergias", e.target.value)}
                  disabled={isSubmitting}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
              <Label htmlFor="hallazgosExamen">Hallazgos por aparato</Label>
              <textarea
                id="hallazgosExamen"
                name="hallazgosExamen"
                rows={5}
                placeholder="Cardiovascular, respiratorio, digestivo, neurológico…"
                value={form.hallazgosExamen}
                onChange={(e) => updateField("hallazgosExamen", e.target.value)}
                disabled={isSubmitting}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </FormField>
          </CardContent>
        </Card>

        {/* ── 4. Diagnósticos CIE-10 (HC-004) ──────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnósticos (CIE-10)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="dxCodigo">Código CIE-10</Label>
                <Input
                  id="dxCodigo"
                  name="dxCodigo"
                  placeholder="Ej. J18.9"
                  value={dxInput.code}
                  onChange={(e) =>
                    setDxInput((d) => ({ ...d, code: e.target.value.toUpperCase() }))
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
                  <SelectTrigger id="dxTipo" className="w-36">
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
                aria-label="Agregar diagnóstico"
              >
                Agregar
              </Button>
            </div>
            <FormHint>
              Formato CIE-10: letra mayúscula + 2 dígitos (Ej. J00, I10.0, K29.7). Mínimo un diagnóstico recomendado.
            </FormHint>

            {diagnosticos.length > 0 && (
              <ul className="divide-y rounded-md border" aria-label="Diagnósticos agregados">
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

        {/* ── 5. Plan y disposición ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Plan y disposición</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField>
              <Label htmlFor="planManejo">Plan de manejo</Label>
              <textarea
                id="planManejo"
                name="planManejo"
                rows={5}
                placeholder="Medicamentos, procedimientos, indicaciones, seguimiento…"
                value={form.planManejo}
                onChange={(e) => updateField("planManejo", e.target.value)}
                disabled={isSubmitting}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </FormField>

            <FormField>
              <Label htmlFor="disposicion">Disposición del paciente</Label>
              <Select
                value={form.disposicion}
                onValueChange={(v) => updateField("disposicion", v)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="disposicion">
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
            aria-label="Guardar historia clínica como borrador"
          >
            {isSubmitting ? "Guardando…" : "Guardar borrador"}
          </Button>
        </div>
      </Form>
    </div>
  );
}
