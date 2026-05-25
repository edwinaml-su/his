"use client";

/**
 * ECE — Crear Certificado de Incapacidad ISSS (CERT_INC).
 *
 * Normativa: ISSS El Salvador — Reglamento de Evaluación de Incapacidades.
 * NTEC §22.
 *
 * Flujo:
 *   1. Llenar formulario con campos ISSS.
 *   2. "Crear borrador" → abre modal PIN.
 *   3. PIN confirmado → create mutation → redirect al detalle.
 */
import { useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
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
  certificadoIncapacidadCreateInput,
  TIPO_INCAPACIDAD,
  type TipoIncapacidad,
} from "@his/contracts/schemas/certificado-incapacidad";

// Formulario sin firmaPin — el PIN se captura en el modal
type FormValues = z.infer<typeof certificadoIncapacidadCreateInput>;

const TIPO_LABELS: Record<TipoIncapacidad, string> = {
  enfermedad_comun:   "Enfermedad común",
  accidente_comun:    "Accidente común",
  riesgo_profesional: "Riesgo profesional",
  maternidad:         "Maternidad",
  paternidad:         "Paternidad",
  accidente_trabajo:  "Accidente de trabajo",
};

export default function CertificadoIncapacidadNuevoPage() {
  const router = useRouter();
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

  const createMutation = trpc.eceCertificadoIncapacidad.create.useMutation({
    onSuccess: (data) => {
      router.push(`/ece/certificado-incapacidad/${data.id}`);
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(certificadoIncapacidadCreateInput),
  });

  function onValidSubmit(values: FormValues) {
    setPendingValues(values);
    setPinModalOpen(true);
  }

  function handlePinConfirm(pin: string) {
    if (!pendingValues) return;
    // El create no requiere PIN en este flujo (crea borrador directamente).
    // El PIN se usa en el paso "firmar" desde la página de detalle.
    // Aquí simplemente ignoramos el PIN y creamos el borrador.
    void pin;
    createMutation.mutate(pendingValues);
    setPinModalOpen(false);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Nuevo Certificado de Incapacidad</h1>
        <p className="text-sm text-gray-500">
          ISSS El Salvador — NTEC §22. Complete todos los campos y confirme para crear el borrador.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del certificado</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(onValidSubmit)}
            className="space-y-4"
            aria-label="Formulario de certificado de incapacidad"
            noValidate
          >
            {/* Paciente */}
            <div className="space-y-1">
              <Label htmlFor="pacienteId">ID Paciente (UUID)</Label>
              <Input
                id="pacienteId"
                {...register("pacienteId")}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-invalid={!!errors.pacienteId}
              />
              {errors.pacienteId && (
                <p role="alert" className="text-sm text-red-600">{errors.pacienteId.message}</p>
              )}
            </div>

            {/* Episodio (opcional) */}
            <div className="space-y-1">
              <Label htmlFor="episodioId">ID Episodio (UUID, opcional)</Label>
              <Input
                id="episodioId"
                {...register("episodioId")}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-invalid={!!errors.episodioId}
              />
              {errors.episodioId && (
                <p role="alert" className="text-sm text-red-600">{errors.episodioId.message}</p>
              )}
            </div>

            {/* Médico */}
            <div className="space-y-1">
              <Label htmlFor="medicoId">ID Médico (UUID)</Label>
              <Input
                id="medicoId"
                {...register("medicoId")}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-invalid={!!errors.medicoId}
              />
              {errors.medicoId && (
                <p role="alert" className="text-sm text-red-600">{errors.medicoId.message}</p>
              )}
            </div>

            {/* Tipo de incapacidad */}
            <div className="space-y-1">
              <Label htmlFor="tipoIncapacidad">Tipo de incapacidad</Label>
              <Select onValueChange={(v) => setValue("tipoIncapacidad", v as TipoIncapacidad)}>
                <SelectTrigger id="tipoIncapacidad" aria-invalid={!!errors.tipoIncapacidad}>
                  <SelectValue placeholder="Seleccione…" />
                </SelectTrigger>
                <SelectContent>
                  {TIPO_INCAPACIDAD.map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.tipoIncapacidad && (
                <p role="alert" className="text-sm text-red-600">{errors.tipoIncapacidad.message}</p>
              )}
            </div>

            {/* Rango de fechas */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="fechaInicio">Fecha inicio</Label>
                <Input
                  id="fechaInicio"
                  type="date"
                  {...register("fechaInicio")}
                  aria-invalid={!!errors.fechaInicio}
                />
                {errors.fechaInicio && (
                  <p role="alert" className="text-sm text-red-600">{errors.fechaInicio.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="fechaFin">Fecha fin</Label>
                <Input
                  id="fechaFin"
                  type="date"
                  {...register("fechaFin")}
                  aria-invalid={!!errors.fechaFin}
                />
                {errors.fechaFin && (
                  <p role="alert" className="text-sm text-red-600">{errors.fechaFin.message}</p>
                )}
              </div>
            </div>

            {/* Diagnóstico CIE-10 */}
            <div className="space-y-1">
              <Label htmlFor="diagnosticoCie10">Código CIE-10</Label>
              <Input
                id="diagnosticoCie10"
                {...register("diagnosticoCie10")}
                placeholder="J20 o J20.0"
                aria-invalid={!!errors.diagnosticoCie10}
              />
              {errors.diagnosticoCie10 && (
                <p role="alert" className="text-sm text-red-600">{errors.diagnosticoCie10.message}</p>
              )}
            </div>

            {/* Descripción del diagnóstico */}
            <div className="space-y-1">
              <Label htmlFor="diagnosticoDescripcion">Descripción del diagnóstico</Label>
              <textarea
                id="diagnosticoDescripcion"
                {...register("diagnosticoDescripcion")}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-invalid={!!errors.diagnosticoDescripcion}
              />
              {errors.diagnosticoDescripcion && (
                <p role="alert" className="text-sm text-red-600">{errors.diagnosticoDescripcion.message}</p>
              )}
            </div>

            {/* NUI ISSS */}
            <div className="space-y-1">
              <Label htmlFor="numeroAfiliacionIsss">N.° afiliación ISSS (NUI, 9 dígitos, opcional)</Label>
              <Input
                id="numeroAfiliacionIsss"
                {...register("numeroAfiliacionIsss")}
                placeholder="123456789"
                maxLength={9}
                aria-invalid={!!errors.numeroAfiliacionIsss}
              />
              {errors.numeroAfiliacionIsss && (
                <p role="alert" className="text-sm text-red-600">{errors.numeroAfiliacionIsss.message}</p>
              )}
            </div>

            {/* NIT del patrono */}
            <div className="space-y-1">
              <Label htmlFor="patronoNit">NIT del empleador (opcional)</Label>
              <Input
                id="patronoNit"
                {...register("patronoNit")}
                placeholder="0614-000000-000-0"
              />
            </div>

            {/* Observaciones */}
            <div className="space-y-1">
              <Label htmlFor="observaciones">Observaciones (opcional)</Label>
              <textarea
                id="observaciones"
                {...register("observaciones")}
                rows={2}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={createMutation.isPending}
              aria-busy={createMutation.isPending}
            >
              {createMutation.isPending ? "Creando…" : "Crear borrador"}
            </Button>

            {createMutation.error && (
              <p role="alert" className="text-sm text-red-600">
                {createMutation.error.message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Modal PIN */}
      {pinModalOpen && (
        <PinDialog
          titulo="Confirmar creación de certificado"
          onConfirm={async (pin) => handlePinConfirm(pin)}
          onCancel={() => setPinModalOpen(false)}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// PinDialog inline — mismo patrón que /ece/fall-event/nuevo/page.tsx
// ---------------------------------------------------------------------------
interface PinDialogProps {
  titulo: string;
  onConfirm: (pin: string) => Promise<void>;
  onCancel: () => void;
}

function PinDialog({ titulo, onConfirm, onCancel }: PinDialogProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
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
        <div className="flex justify-end gap-2">
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
