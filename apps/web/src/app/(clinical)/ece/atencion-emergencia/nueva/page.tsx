"use client";

/**
 * ECE — Formulario nueva atención de emergencia.
 *
 * 4 secciones clínicas: motivo consulta · exploración · diagnóstico · plan.
 * Post-creación redirige al detalle para que MT firme inline.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@his/ui/components/card";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

interface AtencionForm {
  episodioId: string;
  motivoConsulta: string;
  exploracion: string;
  diagnostico: string;
  planTerapeutico: string;
}

const INITIAL: AtencionForm = {
  episodioId: "",
  motivoConsulta: "",
  exploracion: "",
  diagnostico: "",
  planTerapeutico: "",
};

function validate(f: AtencionForm): string | null {
  if (!f.episodioId.trim()) return "El episodio es requerido.";
  if (f.motivoConsulta.trim().length < 5) return "Motivo de consulta debe tener al menos 5 caracteres.";
  if (f.exploracion.trim().length < 5) return "Exploración debe tener al menos 5 caracteres.";
  if (f.diagnostico.trim().length < 5) return "Diagnóstico debe tener al menos 5 caracteres.";
  if (f.planTerapeutico.trim().length < 5) return "Plan terapéutico debe tener al menos 5 caracteres.";
  return null;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 border-b pb-1 text-base font-semibold text-[#1a3c6e]">
      {children}
    </h2>
  );
}

export default function NuevaAtencionEmergenciaPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<AtencionForm>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  function update<K extends keyof AtencionForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const create = trpc.eceAtencionEmergencia.create.useMutation({
    onSuccess: (data) => {
      router.push(`/ece/atencion-emergencia/${data.id}`);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    setClientError(err);
    if (err) return;

    create.mutate({
      episodioId: form.episodioId.trim(),
      motivoConsulta: form.motivoConsulta.trim(),
      exploracion: form.exploracion.trim(),
      diagnostico: form.diagnostico.trim(),
      planTerapeutico: form.planTerapeutico.trim(),
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva atención de emergencia</h1>
        <p className="text-sm text-muted-foreground">
          Complete las 4 secciones clínicas. Al guardar, el documento quedará en estado
          &quot;Borrador&quot; listo para firma MT.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form onSubmit={onSubmit} noValidate>
            {/* Identificación */}
            <SectionTitle>Identificación del episodio</SectionTitle>
            <div className="grid grid-cols-1 gap-3">
              <FormField>
                <Label htmlFor="episodioId">Episodio de atención (UUID)</Label>
                <Input
                  id="episodioId"
                  required
                  placeholder="xxxxxxxx-xxxx-..."
                  value={form.episodioId}
                  onChange={(e) => update("episodioId", e.target.value)}
                />
              </FormField>
            </div>

            {/* Sección 1: Motivo de consulta */}
            <div className="mt-6">
              <SectionTitle>1. Motivo de consulta</SectionTitle>
              <FormField>
                <Label htmlFor="motivoConsulta">
                  Razón principal de consulta al servicio de emergencias
                </Label>
                <textarea
                  id="motivoConsulta"
                  required
                  value={form.motivoConsulta}
                  onChange={(e) => update("motivoConsulta", e.target.value)}
                  placeholder="Paciente acude por dolor torácico de 2 horas de evolución…"
                  className="min-h-[100px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={2000}
                />
              </FormField>
            </div>

            {/* Sección 2: Exploración física */}
            <div className="mt-6">
              <SectionTitle>2. Exploración física</SectionTitle>
              <FormField>
                <Label htmlFor="exploracion">
                  Hallazgos al examen físico (signos vitales, sistemas)
                </Label>
                <textarea
                  id="exploracion"
                  required
                  value={form.exploracion}
                  onChange={(e) => update("exploracion", e.target.value)}
                  placeholder="PA 140/90, FC 98, FR 20, SatO2 96%. Consciente, orientado. Murmullo vesicular…"
                  className="min-h-[120px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={5000}
                />
              </FormField>
            </div>

            {/* Sección 3: Diagnóstico */}
            <div className="mt-6">
              <SectionTitle>3. Diagnóstico</SectionTitle>
              <FormField>
                <Label htmlFor="diagnostico">
                  Diagnóstico de ingreso / impresión clínica (incluir CIE-10 si aplica)
                </Label>
                <textarea
                  id="diagnostico"
                  required
                  value={form.diagnostico}
                  onChange={(e) => update("diagnostico", e.target.value)}
                  placeholder="Síndrome coronario agudo sin elevación del ST. I20.0"
                  className="min-h-[100px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={2000}
                />
              </FormField>
            </div>

            {/* Sección 4: Plan terapéutico */}
            <div className="mt-6">
              <SectionTitle>4. Plan terapéutico</SectionTitle>
              <FormField>
                <Label htmlFor="planTerapeutico">
                  Medicamentos, procedimientos, interconsultas, destino del paciente
                </Label>
                <textarea
                  id="planTerapeutico"
                  required
                  value={form.planTerapeutico}
                  onChange={(e) => update("planTerapeutico", e.target.value)}
                  placeholder="1. Aspirina 300 mg VO stat. 2. Nitroglicerina SL…"
                  className="min-h-[120px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={5000}
                />
              </FormField>
            </div>

            {errorMessage && (
              <div className="mt-4">
                <FormError>{errorMessage}</FormError>
              </div>
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
                {isSubmitting ? "Guardando…" : "Guardar atención (borrador)"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
