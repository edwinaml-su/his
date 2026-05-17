"use client";

/**
 * ECE — Formulario nueva epicrisis.
 * Secciones: resumen ingreso · evolución · diagnóstico egreso CIE-10 ·
 *            tratamiento egreso · indicaciones.
 * Post-creación → redirect a /ece/epicrisis/[id] para firmar.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

interface EpicrisisForm {
  pacienteId: string;
  episodioId: string;
  motivoEgreso: "alta_medica" | "alta_voluntaria" | "traslado" | "fallecido" | "otro";
  // Secciones clínicas
  resumenIngreso: string;
  evolucion: string;
  diagnosticoEgresoCie10: string;
  diagnosticoDescripcion: string;
  tratamientoEgreso: string;
  indicaciones: string;
}

const INITIAL: EpicrisisForm = {
  pacienteId: "",
  episodioId: "",
  motivoEgreso: "alta_medica",
  resumenIngreso: "",
  evolucion: "",
  diagnosticoEgresoCie10: "",
  diagnosticoDescripcion: "",
  tratamientoEgreso: "",
  indicaciones: "",
};

function validate(f: EpicrisisForm): string | null {
  if (!f.pacienteId.trim()) return "Paciente es requerido.";
  if (!f.episodioId.trim()) return "Episodio hospitalario es requerido.";
  if (!f.resumenIngreso.trim()) return "Resumen de ingreso es requerido.";
  if (!f.diagnosticoEgresoCie10.trim()) return "Código CIE-10 de egreso es requerido.";
  return null;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 border-b pb-1 text-base font-semibold text-[#1a3c6e]">
      {children}
    </h2>
  );
}

export default function NuevaEpicrisisPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<EpicrisisForm>(INITIAL);
  const [createdEpisodioId, setCreatedEpisodioId] = React.useState<string | null>(null);
  const [clientError, setClientError] = React.useState<string | null>(null);

  function update<K extends keyof EpicrisisForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const create = trpc.workflowInstance.create.useMutation({
    onSuccess: (data) => {
      if (form.motivoEgreso === "fallecido" && form.episodioId.trim()) {
        // Motivo defunción: mostrar link al certificado antes de redirigir.
        setCreatedEpisodioId(form.episodioId.trim());
      } else {
        router.push(`/ece/epicrisis/${data.id}`);
      }
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    setClientError(err);
    if (err) return;

    create.mutate({
      tipoDocumentoId: "epicrisis", // UI placeholder — en prod resolver UUID por código
      pacienteId: form.pacienteId.trim(),
      episodioId: form.episodioId.trim() || undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  // Pantalla de confirmación cuando el egreso es por defunción
  if (createdEpisodioId) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Epicrisis guardada</h1>
        <div
          role="note"
          className="flex items-start gap-3 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Egreso por defunción — acción requerida</p>
            <p className="mt-1">
              El motivo de egreso registrado es <strong>fallecido</strong>. Para cumplir con
              la NTEC y el Acuerdo MINSAL 1616-2024, debe emitir el{" "}
              <strong>Certificado de Defunción</strong>.
            </p>
            <div className="mt-3 flex gap-2">
              <Link
                href={`/ece/defuncion/nueva?episodioId=${createdEpisodioId}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Crear Certificado de Defunción
              </Link>
              <button
                type="button"
                onClick={() => router.push("/ece/epicrisis")}
                className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Ir a Epicrisis
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva epicrisis</h1>
        <p className="text-sm text-muted-foreground">
          Complete el resumen de egreso. Al guardar, el documento quedará en estado
          &quot;Borrador&quot; listo para firma MC.
        </p>
      </div>

      {/* Banner inmutabilidad */}
      <div
        role="note"
        className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
      >
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>Documento inmutable post-firma.</strong> Una vez firmado por MC, no se
          podrá modificar el contenido clínico.
        </span>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form onSubmit={onSubmit} noValidate>
            {/* Identificadores */}
            <SectionTitle>Identificación</SectionTitle>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField>
                <Label htmlFor="pacienteId">Paciente (UUID)</Label>
                <Input
                  id="pacienteId"
                  required
                  placeholder="xxxxxxxx-xxxx-..."
                  value={form.pacienteId}
                  onChange={(e) => update("pacienteId", e.target.value)}
                />
              </FormField>
              <FormField>
                <Label htmlFor="episodioId">Episodio hospitalario (UUID)</Label>
                <Input
                  id="episodioId"
                  required
                  placeholder="xxxxxxxx-xxxx-..."
                  value={form.episodioId}
                  onChange={(e) => update("episodioId", e.target.value)}
                />
              </FormField>
            </div>

            {/* Motivo de egreso */}
            <div className="mt-6">
              <SectionTitle>Motivo de egreso</SectionTitle>
              <FormField>
                <Label htmlFor="motivoEgreso">Motivo de egreso</Label>
                <select
                  id="motivoEgreso"
                  value={form.motivoEgreso}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      motivoEgreso: e.target.value as EpicrisisForm["motivoEgreso"],
                    }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="alta_medica">Alta médica</option>
                  <option value="alta_voluntaria">Alta voluntaria</option>
                  <option value="traslado">Traslado</option>
                  <option value="fallecido">Fallecido</option>
                  <option value="otro">Otro</option>
                </select>
                {form.motivoEgreso === "fallecido" && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Al guardar, se solicitará crear el Certificado de Defuncion ECE (NTEC Art. 21).
                  </p>
                )}
              </FormField>
            </div>

            {/* Resumen ingreso */}
            <div className="mt-6">
              <SectionTitle>Resumen de ingreso</SectionTitle>
              <FormField>
                <Label htmlFor="resumenIngreso">
                  Motivo de ingreso, antecedentes relevantes, hallazgos iniciales
                </Label>
                <textarea
                  id="resumenIngreso"
                  required
                  value={form.resumenIngreso}
                  onChange={(e) => update("resumenIngreso", e.target.value)}
                  placeholder="Paciente de X años que ingresó el… con diagnóstico de…"
                  className="min-h-[120px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={4000}
                />
              </FormField>
            </div>

            {/* Evolución */}
            <div className="mt-6">
              <SectionTitle>Evolución durante la hospitalización</SectionTitle>
              <FormField>
                <Label htmlFor="evolucion">
                  Procedimientos realizados, respuesta al tratamiento, complicaciones
                </Label>
                <textarea
                  id="evolucion"
                  value={form.evolucion}
                  onChange={(e) => update("evolucion", e.target.value)}
                  placeholder="Durante la hospitalización se realizó… con respuesta…"
                  className="min-h-[120px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={4000}
                />
              </FormField>
            </div>

            {/* Diagnóstico egreso CIE-10 */}
            <div className="mt-6">
              <SectionTitle>Diagnóstico de egreso</SectionTitle>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <FormField>
                  <Label htmlFor="cie10">Código CIE-10</Label>
                  <Input
                    id="cie10"
                    required
                    placeholder="Ej. J18.9"
                    value={form.diagnosticoEgresoCie10}
                    onChange={(e) =>
                      update("diagnosticoEgresoCie10", e.target.value.toUpperCase())
                    }
                    maxLength={10}
                  />
                </FormField>
                <div className="md:col-span-2">
                  <FormField>
                    <Label htmlFor="diagDesc">Descripción del diagnóstico</Label>
                    <Input
                      id="diagDesc"
                      placeholder="Neumonía no especificada…"
                      value={form.diagnosticoDescripcion}
                      onChange={(e) => update("diagnosticoDescripcion", e.target.value)}
                      maxLength={500}
                    />
                  </FormField>
                </div>
              </div>
            </div>

            {/* Tratamiento egreso */}
            <div className="mt-6">
              <SectionTitle>Tratamiento al egreso</SectionTitle>
              <FormField>
                <Label htmlFor="tratamientoEgreso">Medicamentos, dosis, duración</Label>
                <textarea
                  id="tratamientoEgreso"
                  value={form.tratamientoEgreso}
                  onChange={(e) => update("tratamientoEgreso", e.target.value)}
                  placeholder="1. Amoxicilina 500 mg cada 8h por 7 días…"
                  className="min-h-[100px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={3000}
                />
              </FormField>
            </div>

            {/* Indicaciones */}
            <div className="mt-6">
              <SectionTitle>Indicaciones al paciente</SectionTitle>
              <FormField>
                <Label htmlFor="indicaciones">
                  Dieta, actividad, citas de seguimiento, signos de alarma
                </Label>
                <textarea
                  id="indicaciones"
                  value={form.indicaciones}
                  onChange={(e) => update("indicaciones", e.target.value)}
                  placeholder="Dieta blanda por 5 días. Control en consulta externa en 2 semanas. Consultar si…"
                  className="min-h-[100px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={3000}
                />
              </FormField>
            </div>

            {errorMessage && (
              <FormError>{errorMessage}</FormError>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Guardando…" : "Guardar epicrisis (borrador)"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
