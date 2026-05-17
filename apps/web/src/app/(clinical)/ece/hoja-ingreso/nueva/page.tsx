"use client";

/**
 * ECE — Wizard nueva Hoja de Ingreso Hospitalario.
 *
 * 3 pasos:
 *   1. Paciente + Orden de ingreso (buscar por ID de orden)
 *   2. Datos clínicos (servicio, cama, modalidad, procedencia, diagnóstico)
 *   3. Firma ADM con PIN electrónico
 *
 * Rol requerido: ADM.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Textarea } from "@his/ui/components/textarea";
import { trpc } from "@/lib/trpc/react";

// ─── Tipos de estado del wizard ───────────────────────────────────────────────

interface Step1State {
  ordenIngresoId: string;
}

interface Step2State {
  fechaHoraIngreso: string;       // ISO datetime-local string
  servicioIngresoId: string;
  camaAsignadaId: string;
  modalidad: "urgente" | "programado" | "";
  procedencia: string;
  diagnosticoIngreso: string;
  motivoConsulta: string;
}

interface Step3State {
  pin: string;
  /** id de la hoja recién creada (post-create, pre-firma) */
  hojaId: string;
}

const STEPS = [
  "Paciente y orden",
  "Datos clínicos",
  "Firma ADM",
];

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Pasos" className="mb-6">
      <ol className="flex items-center gap-0">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <React.Fragment key={label}>
              <li className="flex flex-col items-center">
                <span
                  aria-current={active ? "step" : undefined}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors"
                  style={{
                    background: done ? "var(--color-primary)" : active ? "var(--color-primary)" : "var(--color-muted)",
                    color: done || active ? "var(--color-primary-foreground)" : "var(--color-muted-foreground)",
                  }}
                >
                  {done ? (
                    <CheckCircle2 className="h-5 w-5" aria-hidden />
                  ) : (
                    <Circle className="h-5 w-5" aria-hidden />
                  )}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">{label}</span>
              </li>
              {i < STEPS.length - 1 && (
                <ChevronRight
                  className="mx-1 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function NuevaHojaIngresoPage() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);

  const [step1, setStep1] = React.useState<Step1State>({ ordenIngresoId: "" });
  const [step2, setStep2] = React.useState<Step2State>({
    fechaHoraIngreso: new Date().toISOString().slice(0, 16),
    servicioIngresoId: "",
    camaAsignadaId: "",
    modalidad: "",
    procedencia: "",
    diagnosticoIngreso: "",
    motivoConsulta: "",
  });
  const [step3, setStep3] = React.useState<Step3State>({ pin: "", hojaId: "" });

  const createMutation = trpc.eceHojaIngreso.create.useMutation();
  const firmarMutation = trpc.eceHojaIngreso.firmar.useMutation();

  // ── Paso 1 → 2: buscar orden ──────────────────────────────────────────────
  function handleStep1Next() {
    if (!step1.ordenIngresoId.trim()) return;
    setStep(1);
  }

  // ── Paso 2 → 3: crear hoja en borrador ───────────────────────────────────
  async function handleStep2Next() {
    if (!step2.modalidad) return;

    try {
      const result = await createMutation.mutateAsync({
        ordenIngresoId: step1.ordenIngresoId,
        fechaHoraIngreso: new Date(step2.fechaHoraIngreso),
        servicioIngresoId: step2.servicioIngresoId,
        camaAsignadaId: step2.camaAsignadaId || undefined,
        modalidad: step2.modalidad as "urgente" | "programado",
        procedencia: step2.procedencia,
        diagnosticoIngreso: step2.diagnosticoIngreso || undefined,
        motivoConsulta: step2.motivoConsulta || undefined,
      });
      setStep3((s) => ({ ...s, hojaId: result.id }));
      setStep(2);
    } catch {
      // El error se muestra en el UI via createMutation.error
    }
  }

  // ── Paso 3: firmar con PIN ────────────────────────────────────────────────
  async function handleFirmar() {
    if (!step3.pin || !step3.hojaId) return;

    try {
      await firmarMutation.mutateAsync({ id: step3.hojaId, pin: step3.pin });
      router.push(`/ece/hoja-ingreso/${step3.hojaId}`);
    } catch {
      // El error se muestra via firmarMutation.error
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva hoja de ingreso</h1>
        <p className="text-sm text-muted-foreground">ECE Hospitalario — Doc 12 NTEC §3.12</p>
      </div>

      <StepIndicator current={step} />

      {/* ── Paso 1: Paciente + Orden ── */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Paso 1 — Orden de ingreso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="orden-id">ID de la orden de ingreso (UUID)</Label>
              <Input
                id="orden-id"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={step1.ordenIngresoId}
                onChange={(e) => setStep1({ ordenIngresoId: e.target.value })}
                aria-required="true"
              />
              <p className="text-xs text-muted-foreground">
                La orden de ingreso identifica al paciente y al episodio hospitalario asociado.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleStep1Next}
                disabled={!step1.ordenIngresoId.trim()}
              >
                Siguiente
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Paso 2: Datos clínicos ── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Paso 2 — Datos clínicos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fecha-hora">Fecha y hora de ingreso</Label>
                <Input
                  id="fecha-hora"
                  type="datetime-local"
                  value={step2.fechaHoraIngreso}
                  onChange={(e) =>
                    setStep2((s) => ({ ...s, fechaHoraIngreso: e.target.value }))
                  }
                  aria-required="true"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="modalidad">Modalidad</Label>
                <Select
                  value={step2.modalidad}
                  onValueChange={(v) =>
                    setStep2((s) => ({ ...s, modalidad: v as "urgente" | "programado" }))
                  }
                >
                  <SelectTrigger id="modalidad">
                    <SelectValue placeholder="Seleccionar…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgente">Urgente</SelectItem>
                    <SelectItem value="programado">Programado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="servicio-id">ID Servicio de ingreso (UUID)</Label>
                <Input
                  id="servicio-id"
                  placeholder="xxxxxxxx-xxxx-..."
                  value={step2.servicioIngresoId}
                  onChange={(e) =>
                    setStep2((s) => ({ ...s, servicioIngresoId: e.target.value }))
                  }
                  aria-required="true"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cama-id">ID Cama asignada (UUID, opcional)</Label>
                <Input
                  id="cama-id"
                  placeholder="xxxxxxxx-xxxx-..."
                  value={step2.camaAsignadaId}
                  onChange={(e) =>
                    setStep2((s) => ({ ...s, camaAsignadaId: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="procedencia">Procedencia</Label>
              <Input
                id="procedencia"
                placeholder="Ej. Urgencias, consulta externa, traslado…"
                value={step2.procedencia}
                onChange={(e) =>
                  setStep2((s) => ({ ...s, procedencia: e.target.value }))
                }
                aria-required="true"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="diagnostico">Diagnóstico de ingreso (opcional)</Label>
              <Textarea
                id="diagnostico"
                rows={2}
                value={step2.diagnosticoIngreso}
                onChange={(e) =>
                  setStep2((s) => ({ ...s, diagnosticoIngreso: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="motivo">Motivo de consulta (opcional)</Label>
              <Textarea
                id="motivo"
                rows={2}
                value={step2.motivoConsulta}
                onChange={(e) =>
                  setStep2((s) => ({ ...s, motivoConsulta: e.target.value }))
                }
              />
            </div>

            {createMutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {createMutation.error.message}
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                Atrás
              </Button>
              <Button
                onClick={handleStep2Next}
                disabled={
                  !step2.modalidad ||
                  !step2.servicioIngresoId.trim() ||
                  !step2.procedencia.trim() ||
                  createMutation.isPending
                }
              >
                {createMutation.isPending ? "Guardando…" : "Siguiente"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Paso 3: Firma ADM ── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Paso 3 — Firma electrónica ADM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ingrese su PIN electrónico para firmar la hoja de ingreso.
              Una vez firmada, el documento pasa a estado <strong>firmado</strong> y
              queda disponible para validación por ARCH.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pin">PIN electrónico (6-8 dígitos)</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="••••••"
                value={step3.pin}
                onChange={(e) => setStep3((s) => ({ ...s, pin: e.target.value }))}
                aria-required="true"
              />
            </div>

            {firmarMutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {firmarMutation.error.message}
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Atrás
              </Button>
              <Button
                onClick={handleFirmar}
                disabled={
                  !step3.pin.trim() ||
                  !step3.hojaId ||
                  firmarMutation.isPending
                }
              >
                {firmarMutation.isPending ? "Firmando…" : "Firmar y guardar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
