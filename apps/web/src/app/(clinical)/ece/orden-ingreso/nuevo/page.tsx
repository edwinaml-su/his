"use client";

/**
 * ECE — Nueva Orden de Ingreso (ORD_ING, NTEC Art. 33).
 *
 * El médico (MC/ESP) ordena el internamiento del paciente completando
 * todos los campos clínicos requeridos y firmando con PIN electrónico.
 *
 * Flujo: formulario → "Crear y firmar" → PinDialog → create + firmar.
 */
import { useState, type FormEvent } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { z } from "zod";
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
import { trpc } from "@/lib/trpc/react";
import {
  ordenIngresoCreateInput,
  MODALIDAD_ING,
  MOTIVO_INGRESO_TIPO,
  PROCEDENCIA,
} from "@his/contracts/schemas/orden-ingreso";

// ─── Schema form (sin firmaPin — lo captura el modal) ─────────────────────────

const formSchema = ordenIngresoCreateInput;
type FormValues = z.infer<typeof formSchema>;

// ─── Labels en español ────────────────────────────────────────────────────────

const MODALIDAD_LABELS: Record<typeof MODALIDAD_ING[number], string> = {
  hospitalizacion: "Hospitalización",
  hospital_de_dia: "Hospital de día",
};

const MOTIVO_TIPO_LABELS: Record<typeof MOTIVO_INGRESO_TIPO[number], string> = {
  cirugia:          "Cirugía",
  emergencia:       "Emergencia",
  hospitalizacion:  "Hospitalización médica",
  obs:              "Obstetricia",
  otro:             "Otro",
};

const PROCEDENCIA_LABELS: Record<typeof PROCEDENCIA[number], string> = {
  consulta_externa:   "Consulta externa",
  emergencia:         "Emergencia",
  traslado_externo:   "Traslado externo",
  traslado_interno:   "Traslado interno",
  espontaneo:         "Espontáneo",
  otro:               "Otro",
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function OrdenIngresoNuevoPage() {
  const router = useRouter();
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

  const createMutation = trpc.eceOrdenIngreso.create.useMutation();
  const firmarMutation = trpc.eceOrdenIngreso.firmar.useMutation({
    onSuccess: (_, vars) => {
      router.push(`/ece/orden-ingreso/${vars.id}`);
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fechaHoraOrden: new Date(),
      diagnosticoIngreso: [],
    },
  });

  const { fields: diagFields, append: appendDiag, remove: removeDiag } = useFieldArray({
    control,
    name: "diagnosticoIngreso",
  });

  const watchedMotivoTipo = watch("motivoIngresoTipo");

  function onValidSubmit(values: FormValues) {
    setPendingValues(values);
    setPinModalOpen(true);
  }

  async function handlePinConfirm(pin: string) {
    if (!pendingValues) return;
    const { id } = await createMutation.mutateAsync(pendingValues);
    await firmarMutation.mutateAsync({ id, firmaPin: pin });
    setPinModalOpen(false);
  }

  const isSubmitting = createMutation.isPending || firmarMutation.isPending;
  const submitError  = createMutation.error ?? firmarMutation.error;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-xl font-semibold text-gray-900">Nueva Orden de Ingreso</h1>
      <p className="text-sm text-gray-500">
        NTEC Art. 33 — Decisión clínica de internamiento. Prerrequisito de la Hoja de Ingreso.
      </p>

      <Card>
        <CardHeader><CardTitle>Datos de la orden</CardTitle></CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(onValidSubmit)}
            className="space-y-4"
            noValidate
          >
            {/* Paciente ID */}
            <FieldGroup label="ID Paciente (UUID)" error={errors.pacienteId?.message}>
              <Input
                {...register("pacienteId")}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-invalid={!!errors.pacienteId}
              />
            </FieldGroup>

            {/* Episodio origen (opcional) */}
            <FieldGroup label="ID Episodio origen (opcional)" error={errors.episodioOrigenId?.message}>
              <Input
                {...register("episodioOrigenId")}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </FieldGroup>

            {/* Médico que ordena */}
            <FieldGroup label="ID Médico que ordena (UUID)" error={errors.medicoOrdena?.message}>
              <Input
                {...register("medicoOrdena")}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-invalid={!!errors.medicoOrdena}
              />
            </FieldGroup>

            {/* Fecha/hora orden */}
            <FieldGroup label="Fecha y hora de la orden" error={errors.fechaHoraOrden?.message}>
              <Input
                type="datetime-local"
                {...register("fechaHoraOrden")}
                aria-invalid={!!errors.fechaHoraOrden}
              />
            </FieldGroup>

            {/* Modalidad */}
            <FieldGroup label="Modalidad" error={errors.modalidad?.message}>
              <Select onValueChange={(v) => setValue("modalidad", v as typeof MODALIDAD_ING[number])}>
                <SelectTrigger aria-invalid={!!errors.modalidad}>
                  <SelectValue placeholder="Seleccione..." />
                </SelectTrigger>
                <SelectContent>
                  {MODALIDAD_ING.map((m) => (
                    <SelectItem key={m} value={m}>{MODALIDAD_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldGroup>

            {/* Motivo tipo */}
            <FieldGroup label="Tipo de motivo" error={errors.motivoIngresoTipo?.message}>
              <Select onValueChange={(v) => setValue("motivoIngresoTipo", v as typeof MOTIVO_INGRESO_TIPO[number])}>
                <SelectTrigger aria-invalid={!!errors.motivoIngresoTipo}>
                  <SelectValue placeholder="Seleccione..." />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVO_INGRESO_TIPO.map((t) => (
                    <SelectItem key={t} value={t}>{MOTIVO_TIPO_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldGroup>

            {/* Procedencia */}
            <FieldGroup label="Procedencia" error={errors.procedencia?.message}>
              <Select onValueChange={(v) => setValue("procedencia", v as typeof PROCEDENCIA[number])}>
                <SelectTrigger aria-invalid={!!errors.procedencia}>
                  <SelectValue placeholder="Seleccione..." />
                </SelectTrigger>
                <SelectContent>
                  {PROCEDENCIA.map((p) => (
                    <SelectItem key={p} value={p}>{PROCEDENCIA_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldGroup>

            {/* Servicio de ingreso */}
            <FieldGroup label="ID Servicio de ingreso (opcional)" error={errors.servicioIngresoId?.message}>
              <Input {...register("servicioIngresoId")} placeholder="UUID del servicio" />
            </FieldGroup>

            {/* Motivo de ingreso */}
            <FieldGroup label="Motivo de ingreso" error={errors.motivoIngreso?.message}>
              <textarea
                {...register("motivoIngreso")}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Descripción clínica del motivo de ingreso (mín. 10 caracteres)..."
                aria-invalid={!!errors.motivoIngreso}
              />
            </FieldGroup>

            {/* Circunstancia de ingreso */}
            <FieldGroup label="Circunstancia del ingreso" error={errors.circunstanciaIngreso?.message}>
              <textarea
                {...register("circunstanciaIngreso")}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Contexto clínico del ingreso..."
                aria-invalid={!!errors.circunstanciaIngreso}
              />
            </FieldGroup>

            {/* Procedimiento CIE-10 (opcional) */}
            <FieldGroup label="Código procedimiento CIE-10 (opcional)" error={errors.procedimientoCie10?.message}>
              <Input
                {...register("procedimientoCie10")}
                placeholder="Ej: Z03.8"
                aria-invalid={!!errors.procedimientoCie10}
              />
            </FieldGroup>

            {/* Diagnósticos de ingreso */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Diagnósticos de ingreso</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => appendDiag({ cie10: "", descripcion: "", principal: diagFields.length === 0 })}
                >
                  Agregar diagnóstico
                </Button>
              </div>
              {diagFields.map((field, index) => (
                <div key={field.id} className="rounded border p-3 space-y-2">
                  <div className="flex gap-2">
                    <div className="w-28">
                      <Input
                        {...register(`diagnosticoIngreso.${index}.cie10`)}
                        placeholder="CIE-10"
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        {...register(`diagnosticoIngreso.${index}.descripcion`)}
                        placeholder="Descripción del diagnóstico"
                      />
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeDiag(index)}>
                      Quitar
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`diag-principal-${index}`}
                      {...register(`diagnosticoIngreso.${index}.principal`)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor={`diag-principal-${index}`} className="text-sm">
                      Diagnóstico principal
                    </Label>
                  </div>
                </div>
              ))}
            </div>

            {/* Reserva sala quirúrgica — solo visible si cirugia */}
            {watchedMotivoTipo === "cirugia" && (
              <FieldGroup label="ID Reserva sala quirúrgica (UUID)" error={errors.reservaSalaQxId?.message}>
                <Input
                  {...register("reservaSalaQxId")}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </FieldGroup>
            )}

            {submitError && (
              <p role="alert" className="text-sm text-red-600">{submitError.message}</p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? "Procesando..." : "Crear y firmar orden de ingreso"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Modal PIN */}
      {pinModalOpen && (
        <PinDialog
          titulo="Firmar Orden de Ingreso — NTEC Art. 33"
          onConfirm={handlePinConfirm}
          onCancel={() => setPinModalOpen(false)}
        />
      )}
    </main>
  );
}

// ─── Helpers de presentación ──────────────────────────────────────────────────

function FieldGroup({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ─── PinDialog inline ─────────────────────────────────────────────────────────

interface PinDialogProps {
  titulo: string;
  onConfirm: (pin: string) => Promise<void>;
  onCancel: () => void;
}

function PinDialog({ titulo, onConfirm, onCancel }: PinDialogProps) {
  const [pin, setPin]       = useState("");
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pin.trim()) { setError("El PIN es requerido."); return; }
    setError(null);
    setLoading(true);
    try {
      await onConfirm(pin.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al confirmar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-background p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold">{titulo}</h2>
        <div className="space-y-1.5">
          <Label htmlFor="pin-input">PIN de firma electrónica</Label>
          <Input
            id="pin-input"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4–8 dígitos"
            autoFocus
            required
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Verificando…" : "Confirmar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
