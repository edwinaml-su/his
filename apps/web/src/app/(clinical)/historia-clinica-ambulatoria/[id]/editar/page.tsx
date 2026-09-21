"use client";

/**
 * Historia Clínica Ambulatoria — Edición de borrador.
 *
 * Deriva de la revisión R3A (P1-2): el bloqueo RN-03 en creación evita
 * borradores infirmables NUEVOS, pero los creados antes del fix (o los que el
 * médico quiera corregir antes de firmar) no tenían UI de edición aunque
 * `eceHistoriaClinica.update` ya existía en el router.
 *
 * - Carga el borrador vía `eceHistoriaClinica.get` y pre-llena el formulario.
 * - Guarda vía `eceHistoriaClinica.update` (patch por campo; solo se envían
 *   los campos que esta página gestiona — analisisClinico, planItems, etc.
 *   quedan intactos).
 * - Solo edita en estado 'borrador' (HC-005: el server rechaza el UPDATE en
 *   cualquier otro estado; aquí se corta antes de renderizar el formulario).
 * - Mismos campos y validaciones que nueva/page.tsx (sin episodioId, que
 *   `update` no acepta; con alergias, que el jsonb de antecedentes ya persiste).
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
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
  tieneComplementario,
} from "@his/contracts";
import { trpc } from "@/lib/trpc/react";

const TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

// ── Tipos locales ─────────────────────────────────────────────────────────────

/**
 * A diferencia de nueva/page.tsx, conserva `complemento` (CC-0007 RF-08):
 * `update` reemplaza el jsonb de diagnosticos completo, así que descartar el
 * complemento al hidratar lo perdería al guardar (regresión CC-0011 item a).
 */
interface DiagnosticoCie11 {
  codigo: string;
  descripcion: string;
  tipo: (typeof TIPO_DIAGNOSTICO)[number];
  complemento?: string;
}

interface FormState {
  motivoConsulta: string;
  anamnesis: string;
  antecedentesPersonales: string;
  antecedentesFamiliares: string;
  antecedentesGineco: string;
  alergias: string;
  examenFisico: string;
  planTerapeutico: string;
  destino: string;
}

const INITIAL: FormState = {
  motivoConsulta: "",
  anamnesis: "",
  antecedentesPersonales: "",
  antecedentesFamiliares: "",
  antecedentesGineco: "",
  alergias: "",
  examenFisico: "",
  planTerapeutico: "",
  destino: "",
};

const INITIAL_DX: DiagnosticoCie11 = { codigo: "", descripcion: "", tipo: "COMPLEMENTARIO" };

/**
 * `get` devuelve `antecedentes`/`examenFisico` como `unknown` (jsonb sin
 * narrowing en historiaClinicaGetOutput). Vistas locales de los campos que
 * esta página lee; el objeto completo se conserva aparte para no perder
 * claves que el formulario no gestiona (ocupacion, fum/fpp, signosVitales…).
 */
interface AntecedentesView {
  personales?: string;
  familiares?: string;
  obstetricos?: string;
  alergias?: string;
}
interface ExamenFisicoView {
  sistemas?: Array<{ sistema: string; hallazgo: string }>;
  signosVitales?: Record<string, number>;
}

// ── Validación inline (idéntica a nueva/page.tsx, sin episodioId) ─────────────

function validate(form: FormState, dx: DiagnosticoCie11[]): string | null {
  if (!form.motivoConsulta.trim()) return "El motivo de consulta es requerido.";
  for (const d of dx) {
    if (!CIE11_CODE_REGEX.test(d.codigo)) {
      return `Código CIE-11 inválido: '${d.codigo}'.`;
    }
  }
  // RN-03 — mismo bloqueo que en creación: firmar exige ≥1 Complementario
  // (ver historia-clinica.router.ts); guardar sin él dejaría el borrador
  // infirmable hasta una nueva edición.
  if (!tieneComplementario(dx)) {
    return "RN-03: se requiere al menos un diagnóstico de tipo Complementario antes de firmar.";
  }
  return null;
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function EditarHistoriaClinicaAmbulatoriaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [diagnosticos, setDiagnosticos] = React.useState<DiagnosticoCie11[]>([]);
  const [dxInput, setDxInput] = React.useState<DiagnosticoCie11>(INITIAL_DX);
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  // Claves del jsonb que el formulario no edita pero `update` sobreescribiría.
  const extrasRef = React.useRef<{
    antecedentes: Record<string, unknown>;
    signosVitales?: Record<string, number>;
  }>({ antecedentes: {} });

  const query = trpc.eceHistoriaClinica.get.useQuery({ id: params.id });

  const update = trpc.eceHistoriaClinica.update.useMutation({
    onSuccess: () => {
      router.push(`/historia-clinica-ambulatoria/${params.id}`);
    },
  });

  const hc = query.data;
  const esBorrador = hc?.estadoRegistro === "borrador";

  React.useEffect(() => {
    if (!hc || hydrated || hc.estadoRegistro !== "borrador") return;
    const antecedentes = (hc.antecedentes ?? {}) as AntecedentesView & Record<string, unknown>;
    const examenFisico = (hc.examenFisico ?? {}) as ExamenFisicoView;
    extrasRef.current = {
      antecedentes,
      signosVitales: examenFisico.signosVitales,
    };
    const sistemas = examenFisico.sistemas ?? [];
    setForm({
      motivoConsulta: hc.motivoConsulta ?? "",
      anamnesis: hc.enfermedadActual ?? "",
      antecedentesPersonales: antecedentes.personales ?? "",
      antecedentesFamiliares: antecedentes.familiares ?? "",
      antecedentesGineco: antecedentes.obstetricos ?? "",
      alergias: antecedentes.alergias ?? "",
      // nueva/page.tsx solo escribe un sistema "General"; si el borrador trae
      // varios (otro origen), se aplanan a texto y al guardar vuelven como
      // "General" — misma forma que produce la creación.
      examenFisico: sistemas
        .map((s) => (s.sistema === "General" ? s.hallazgo : `${s.sistema}: ${s.hallazgo}`))
        .join("\n"),
      planTerapeutico: hc.planManejo ?? "",
      // Un valor legacy fuera del catálogo (columna disposicion pre-CC-0001)
      // no pasaría destinoEnum al guardar; se hidrata vacío y el médico
      // reselecciona del catálogo vigente.
      destino: (DESTINO_OPTIONS as readonly string[]).includes(hc.destino ?? "")
        ? (hc.destino as string)
        : "",
    });
    setDiagnosticos(hc.diagnosticos ?? []);
    setHydrated(true);
  }, [hc, hydrated]);

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

    // `update` es patch: campo omitido = intacto, campo enviado = reemplazado.
    // Se envían siempre los campos gestionados (texto vacío limpia), y en los
    // jsonb se re-inyectan las claves no gestionadas para no perderlas.
    const hallazgo = form.examenFisico.trim();
    update.mutate({
      id: params.id,
      motivoConsulta: form.motivoConsulta.trim(),
      enfermedadActual: form.anamnesis.trim(),
      antecedentes: {
        ...extrasRef.current.antecedentes,
        personales: form.antecedentesPersonales.trim() || undefined,
        familiares: form.antecedentesFamiliares.trim() || undefined,
        obstetricos: form.antecedentesGineco.trim() || undefined,
        alergias: form.alergias.trim() || undefined,
      },
      examenFisico: {
        sistemas: hallazgo ? [{ sistema: "General", hallazgo }] : [],
        ...(extrasRef.current.signosVitales && {
          signosVitales: extrasRef.current.signosVitales,
        }),
      },
      diagnosticos,
      planManejo: form.planTerapeutico.trim(),
      destino: (form.destino as (typeof DESTINO_OPTIONS)[number]) || undefined,
    });
  }

  const isSubmitting = update.isPending;
  const errorMessage = clientError ?? update.error?.message ?? null;

  // ── Carga / guardas ─────────────────────────────────────────────────────────

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
  if (!hc) {
    return (
      <p className="text-sm text-muted-foreground">
        Historia clínica no encontrada.
      </p>
    );
  }
  if (!esBorrador) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-destructive">
          La historia clínica en estado &apos;{hc.estadoRegistro}&apos; no puede
          editarse. Solo en borrador (HC-005).
        </p>
        <Button asChild variant="outline">
          <Link href={`/historia-clinica-ambulatoria/${params.id}`}>Volver al detalle</Link>
        </Button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Editar Historia Clínica Ambulatoria</h1>
        <p className="text-sm text-muted-foreground">
          {hc.patient
            ? `${hc.patient.firstName} ${hc.patient.lastName}${hc.patient.mrn ? ` · MRN ${hc.patient.mrn}` : ""} — `
            : ""}
          borrador editable hasta ser firmado (NTEC Art. 7).
        </p>
      </div>

      <Form onSubmit={onSubmit} noValidate aria-label="Formulario edición historia clínica ambulatoria">

        {/* ── 1. Consulta ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Consulta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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

              <FormField>
                <Label htmlFor="alergias">Alergias</Label>
                <textarea
                  id="alergias"
                  name="alergias"
                  rows={3}
                  placeholder="Medicamentos, alimentos, látex… y tipo de reacción"
                  value={form.alergias}
                  onChange={(e) => updateField("alergias", e.target.value)}
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

        {/* ── 4. Diagnósticos CIE-11 ───────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnósticos (CIE-11)</CardTitle>
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
                // Radix Select emite onValueChange("") al hidratar `value`
                // programáticamente con el dropdown cerrado (sin ítems
                // montados); no existe opción vacía real, así que se ignora.
                onValueChange={(v) => v && updateField("destino", v)}
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
            onClick={() => router.push(`/historia-clinica-ambulatoria/${params.id}`)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            aria-label="Guardar cambios del borrador de historia clínica ambulatoria"
          >
            {isSubmitting ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </Form>
    </div>
  );
}
