"use client";

/**
 * ECE — Formulario nueva atención de emergencia (NTEC Art. 22).
 *
 * Alineado con columnas reales de ece.atencion_emergencia (HF-27):
 *   circunstanciaLlegada, motivoConsulta, examenFisico (era exploracion),
 *   disposicion, diagnosticos (jsonb {texto}), manejoRealizado (jsonb {texto}).
 *
 * Requiere pacienteId (ece.paciente.id) para crear documento_instancia (HF-28).
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@his/ui/components/card";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

interface AtencionForm {
  episodioId: string;
  pacienteId: string;
  circunstanciaLlegada: string;
  motivoConsulta: string;
  examenFisico: string;
  disposicion: string;
  diagnosticos: string;
  manejoRealizado: string;
}

const INITIAL: AtencionForm = {
  episodioId: "",
  pacienteId: "",
  circunstanciaLlegada: "",
  motivoConsulta: "",
  examenFisico: "",
  disposicion: "",
  diagnosticos: "",
  manejoRealizado: "",
};

function validate(f: AtencionForm): string | null {
  if (!f.episodioId.trim()) return "El episodio es requerido.";
  if (!f.pacienteId.trim()) return "El paciente ECE es requerido.";
  if (f.motivoConsulta.trim().length < 5) return "Motivo de consulta debe tener al menos 5 caracteres.";
  if (f.examenFisico.trim().length < 5) return "Examen físico debe tener al menos 5 caracteres.";
  if (f.diagnosticos.trim().length < 5) return "Diagnósticos debe tener al menos 5 caracteres.";
  if (f.manejoRealizado.trim().length < 5) return "Manejo realizado debe tener al menos 5 caracteres.";
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
  const searchParams = useSearchParams();

  // Permite pre-llenar desde URL: ?episodioId=...&pacienteId=...
  const [form, setForm] = React.useState<AtencionForm>({
    ...INITIAL,
    episodioId: searchParams.get("episodioId") ?? "",
    pacienteId: searchParams.get("pacienteId") ?? "",
  });
  const [clientError, setClientError] = React.useState<string | null>(null);

  function update<K extends keyof AtencionForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const create = trpc.eceAtencionEmergencia.create.useMutation({
    onSuccess: (data: { id: string; instanciaId: string; ok: true }) => {
      router.push(`/ece/atencion-emergencia/${data.id}`);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    setClientError(err);
    if (err) return;

    create.mutate({
      episodioId:           form.episodioId.trim(),
      pacienteId:           form.pacienteId.trim(),
      circunstanciaLlegada: form.circunstanciaLlegada.trim() || undefined,
      motivoConsulta:       form.motivoConsulta.trim(),
      examenFisico:         form.examenFisico.trim(),
      disposicion:          form.disposicion.trim() || undefined,
      diagnosticos:         { texto: form.diagnosticos.trim() },
      manejoRealizado:      { texto: form.manejoRealizado.trim() },
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva atención de emergencia</h1>
        <p className="text-sm text-muted-foreground">
          Complete las secciones clínicas. Al guardar, el documento quedará en estado
          &quot;Borrador&quot; listo para firma electrónica del médico de turno.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form onSubmit={onSubmit} noValidate>
            {/* Identificación */}
            <SectionTitle>Identificación</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <FormField>
                <Label htmlFor="pacienteId">Paciente ECE (UUID)</Label>
                <Input
                  id="pacienteId"
                  required
                  placeholder="xxxxxxxx-xxxx-..."
                  value={form.pacienteId}
                  onChange={(e) => update("pacienteId", e.target.value)}
                />
              </FormField>
            </div>

            {/* Circunstancia de llegada */}
            <div className="mt-6">
              <SectionTitle>Circunstancia de llegada</SectionTitle>
              <FormField>
                <Label htmlFor="circunstanciaLlegada">
                  Cómo llegó el paciente al servicio de emergencias (opcional)
                </Label>
                <textarea
                  id="circunstanciaLlegada"
                  value={form.circunstanciaLlegada}
                  onChange={(e) => update("circunstanciaLlegada", e.target.value)}
                  placeholder="Llegó por sus propios medios, referido de UCSF…"
                  className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={1000}
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

            {/* Sección 2: Examen físico */}
            <div className="mt-6">
              <SectionTitle>2. Examen físico</SectionTitle>
              <FormField>
                <Label htmlFor="examenFisico">
                  Hallazgos al examen físico (signos vitales, sistemas)
                </Label>
                <textarea
                  id="examenFisico"
                  required
                  value={form.examenFisico}
                  onChange={(e) => update("examenFisico", e.target.value)}
                  placeholder="PA 140/90, FC 98, FR 20, SatO2 96%. Consciente, orientado…"
                  className="min-h-[120px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={5000}
                />
              </FormField>
            </div>

            {/* Sección 3: Diagnósticos */}
            <div className="mt-6">
              <SectionTitle>3. Diagnósticos</SectionTitle>
              <FormField>
                <Label htmlFor="diagnosticos">
                  Diagnóstico de ingreso / impresión clínica (incluir CIE-10 si aplica)
                </Label>
                <textarea
                  id="diagnosticos"
                  required
                  value={form.diagnosticos}
                  onChange={(e) => update("diagnosticos", e.target.value)}
                  placeholder="Síndrome coronario agudo sin elevación del ST. I20.0"
                  className="min-h-[100px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={5000}
                />
              </FormField>
            </div>

            {/* Sección 4: Manejo realizado */}
            <div className="mt-6">
              <SectionTitle>4. Manejo realizado</SectionTitle>
              <FormField>
                <Label htmlFor="manejoRealizado">
                  Medicamentos, procedimientos e interconsultas aplicadas durante la atención
                </Label>
                <textarea
                  id="manejoRealizado"
                  required
                  value={form.manejoRealizado}
                  onChange={(e) => update("manejoRealizado", e.target.value)}
                  placeholder="1. Aspirina 300 mg VO stat. 2. Nitroglicerina SL…"
                  className="min-h-[120px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={5000}
                />
              </FormField>
            </div>

            {/* Disposición */}
            <div className="mt-6">
              <SectionTitle>5. Disposición</SectionTitle>
              <FormField>
                <Label htmlFor="disposicion">
                  Destino del paciente al finalizar la atención (opcional)
                </Label>
                <textarea
                  id="disposicion"
                  value={form.disposicion}
                  onChange={(e) => update("disposicion", e.target.value)}
                  placeholder="Admisión a sala de observación, alta con cita, traslado…"
                  className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={1000}
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
