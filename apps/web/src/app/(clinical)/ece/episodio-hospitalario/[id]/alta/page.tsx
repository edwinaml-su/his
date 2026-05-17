"use client";

/**
 * ECE — Wizard de alta médica (3 pasos).
 *
 * Paso 1: motivo de alta + instrucciones (input)
 * Paso 2: revisar epicrisis pre-generada (editable en borrador)
 * Paso 3: firmar epicrisis + confirmar alta definitiva
 *
 * Requiere rol PHYSICIAN (el router lo valida server-side).
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Input } from "@his/ui/components/input";
import { trpc } from "@/lib/trpc/react";
import type { MotivoAlta } from "@his/contracts";

// ─── Tipos locales ────────────────────────────────────────────────────────────

interface AltaFormState {
  motivoAlta: MotivoAlta | "";
  instruccionesAlta: string;
  medicoAltaId: string;
  fechaHoraAlta: string; // ISO string para el input datetime-local
}

interface EpicrisisFormState {
  resumenIngreso: string;
  evolucionHospitalaria: string;
  tratamientoEgreso: string;
}

const MOTIVO_LABEL: Record<MotivoAlta, string> = {
  mejoria: "Mejoría clínica",
  traslado: "Traslado a otro centro",
  alta_voluntaria: "Alta voluntaria",
  defuncion: "Defunción",
};

// ─── Indicador de pasos ───────────────────────────────────────────────────────

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Motivo" },
    { n: 2, label: "Epicrisis" },
    { n: 3, label: "Confirmar" },
  ] as const;
  return (
    <ol
      className="flex items-center gap-2 text-sm"
      aria-label="Pasos del wizard de alta"
    >
      {steps.map((s, idx) => (
        <React.Fragment key={s.n}>
          <li
            aria-current={current === s.n ? "step" : undefined}
            className={[
              "flex items-center gap-1.5 rounded-full px-3 py-1 font-medium",
              current === s.n
                ? "bg-primary text-primary-foreground"
                : current > s.n
                ? "bg-muted text-muted-foreground line-through"
                : "text-muted-foreground",
            ].join(" ")}
          >
            <span aria-hidden>{s.n}</span>
            {s.label}
          </li>
          {idx < steps.length - 1 && (
            <li aria-hidden className="text-muted-foreground">→</li>
          )}
        </React.Fragment>
      ))}
    </ol>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AltaMedicaWizardPage() {
  const params = useParams();
  const router = useRouter();
  const episodioId = typeof params.id === "string" ? params.id : "";

  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [epicrisisId, setEpicrisisId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Paso 1: datos de alta
  const [altaForm, setAltaForm] = React.useState<AltaFormState>({
    motivoAlta: "",
    instruccionesAlta: "",
    medicoAltaId: "",
    fechaHoraAlta: new Date().toISOString().slice(0, 16), // datetime-local format
  });

  // Paso 2: epicrisis editable (solo campos editables en borrador)
  const [epiForm, setEpiForm] = React.useState<EpicrisisFormState>({
    resumenIngreso: "",
    evolucionHospitalaria: "",
    tratamientoEgreso: "",
  });

  // Paso 3: firma (simulada como UUID de firma)
  const [firmaId, setFirmaId] = React.useState("");

  // ─── Mutations ───────────────────────────────────────────────────────────────

  const iniciarAlta = trpc.eceEpisodioHospitalario.iniciarAltaMedica.useMutation({
    onSuccess: (data) => {
      setEpicrisisId(data.epicrisisId);
      setError(null);
      setStep(2);
    },
    onError: (err) => setError(err.message),
  });

  const firmarEpicrisis = trpc.eceEpicrisis.firmar.useMutation({
    onSuccess: () => {
      setError(null);
      setStep(3);
    },
    onError: (err) => setError(err.message),
  });

  const confirmarAlta = trpc.eceEpisodioHospitalario.confirmarAlta.useMutation({
    onSuccess: () => {
      router.push(`/ece/episodio-hospitalario/${episodioId}`);
    },
    onError: (err) => setError(err.message),
  });

  // ─── Handlers por paso ───────────────────────────────────────────────────────

  function handlePaso1Submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!altaForm.motivoAlta) {
      setError("Seleccione un motivo de alta.");
      return;
    }
    if (!altaForm.medicoAltaId.trim()) {
      setError("Ingrese el ID del médico que da el alta.");
      return;
    }
    iniciarAlta.mutate({
      episodioId,
      medicoAltaId: altaForm.medicoAltaId.trim(),
      fechaHoraAlta: new Date(altaForm.fechaHoraAlta),
      motivoAlta: altaForm.motivoAlta as MotivoAlta,
      instruccionesAlta: altaForm.instruccionesAlta.trim(),
    });
  }

  function handlePaso2Continue() {
    setError(null);
    if (!epicrisisId) {
      setError("No hay epicrisis generada.");
      return;
    }
    if (!firmaId.trim()) {
      setError("Ingrese el ID de firma para continuar.");
      return;
    }
    firmarEpicrisis.mutate({ id: epicrisisId, firmaId: firmaId.trim() });
  }

  function handlePaso3Confirm() {
    setError(null);
    if (!epicrisisId) {
      setError("No hay epicrisis para confirmar.");
      return;
    }
    confirmarAlta.mutate({ episodioId, epicrisisId });
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Navegación */}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <a href={`/ece/episodio-hospitalario/${episodioId}`}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Volver al episodio
        </a>
      </Button>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Alta médica</h1>
        <p className="text-sm text-muted-foreground">
          Episodio: <span className="font-mono">{episodioId.slice(0, 8)}…</span>
        </p>
      </div>

      <StepIndicator current={step} />

      {/* Error global */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* PASO 1: Motivo + instrucciones */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Paso 1 — Motivo de alta</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePaso1Submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="motivo">Motivo de alta</Label>
                <Select
                  value={altaForm.motivoAlta}
                  onValueChange={(v) =>
                    setAltaForm((f) => ({ ...f, motivoAlta: v as MotivoAlta }))
                  }
                >
                  <SelectTrigger id="motivo">
                    <SelectValue placeholder="Seleccione motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(MOTIVO_LABEL) as [MotivoAlta, string][]).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="medico">ID médico que da el alta (UUID)</Label>
                <Input
                  id="medico"
                  placeholder="xxxxxxxx-xxxx-…"
                  value={altaForm.medicoAltaId}
                  onChange={(e) => setAltaForm((f) => ({ ...f, medicoAltaId: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fecha-alta">Fecha y hora de alta</Label>
                <Input
                  id="fecha-alta"
                  type="datetime-local"
                  value={altaForm.fechaHoraAlta}
                  onChange={(e) => setAltaForm((f) => ({ ...f, fechaHoraAlta: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="instrucciones">Instrucciones de alta</Label>
                <Textarea
                  id="instrucciones"
                  rows={5}
                  placeholder="Indique medicamentos, cuidados, citas de seguimiento…"
                  value={altaForm.instruccionesAlta}
                  onChange={(e) => setAltaForm((f) => ({ ...f, instruccionesAlta: e.target.value }))}
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={iniciarAlta.isPending}>
                  {iniciarAlta.isPending ? "Procesando…" : (
                    <>
                      Continuar
                      <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* PASO 2: Revisar / completar epicrisis pre-generada */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Paso 2 — Revisar epicrisis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Epicrisis creada:{" "}
                <span className="font-mono text-foreground">
                  {epicrisisId?.slice(0, 8)}…
                </span>
                . Complete los campos y firme para avanzar.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="resumen">Resumen de ingreso</Label>
                <Textarea
                  id="resumen"
                  rows={4}
                  placeholder="Antecedentes, motivo, evolución durante la hospitalización…"
                  value={epiForm.resumenIngreso}
                  onChange={(e) => setEpiForm((f) => ({ ...f, resumenIngreso: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="evolucion">Evolución hospitalaria</Label>
                <Textarea
                  id="evolucion"
                  rows={4}
                  placeholder="Evolución durante el ingreso, complicaciones…"
                  value={epiForm.evolucionHospitalaria}
                  onChange={(e) => setEpiForm((f) => ({ ...f, evolucionHospitalaria: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tratamiento">Tratamiento al egreso</Label>
                <Textarea
                  id="tratamiento"
                  rows={3}
                  placeholder="Medicamentos con dosis y posología…"
                  value={epiForm.tratamientoEgreso}
                  onChange={(e) => setEpiForm((f) => ({ ...f, tratamientoEgreso: e.target.value }))}
                />
              </div>

              <hr />

              <div className="space-y-1.5">
                <Label htmlFor="firma-id">ID de firma electrónica (UUID)</Label>
                <Input
                  id="firma-id"
                  placeholder="UUID de la firma del MC"
                  value={firmaId}
                  onChange={(e) => setFirmaId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  La firma electrónica es validada por el módulo §firma (NTEC Art. 40).
                </p>
              </div>

              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={firmarEpicrisis.isPending}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
                  Atrás
                </Button>
                <Button
                  onClick={handlePaso2Continue}
                  disabled={firmarEpicrisis.isPending}
                >
                  {firmarEpicrisis.isPending ? "Firmando…" : (
                    <>
                      Firmar epicrisis
                      <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PASO 3: Confirmar alta */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Paso 3 — Confirmar alta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm space-y-1">
                <p>
                  <span className="font-medium">Motivo: </span>
                  {altaForm.motivoAlta ? MOTIVO_LABEL[altaForm.motivoAlta as MotivoAlta] : "—"}
                </p>
                <p>
                  <span className="font-medium">Epicrisis: </span>
                  <span className="font-mono">{epicrisisId?.slice(0, 8)}… (firmada)</span>
                </p>
              </div>

              <p className="text-sm">
                Al confirmar se cerrará el episodio, se registrará la fecha de egreso y se
                liberará la cama. Esta acción no puede revertirse.
              </p>

              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  disabled={confirmarAlta.isPending}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
                  Atrás
                </Button>
                <Button
                  onClick={handlePaso3Confirm}
                  disabled={confirmarAlta.isPending}
                  className="bg-destructive/90 hover:bg-destructive text-white"
                >
                  {confirmarAlta.isPending ? "Procesando…" : (
                    <>
                      <Check className="mr-1 h-4 w-4" aria-hidden />
                      Confirmar alta
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
