"use client";

/**
 * Página — Registrar Evento de Caída.
 *
 * JCI Standard: IPSG.6 ME 4
 * US.5.16 — Formulario estructurado reporte de caídas.
 *
 * - Auto-lookup del último Morse score del paciente para mostrar FallRiskInterventions.
 * - Validación Zod inline (lugar=otro → lugarOtro obligatorio).
 * - Modal PIN al submit.
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
import { FallRiskInterventions } from "@/components/fall-risk-interventions";
import { trpc } from "@/lib/trpc/react";
import {
  fallEventBaseObjectSchema,
  FALL_LUGAR,
  FALL_TESTIGO_TIPO,
  FALL_LESION,
} from "@his/contracts/schemas/fall-event";

// ---------------------------------------------------------------------------
// Schema del form (sin firmaPin — lo captura el modal)
// ---------------------------------------------------------------------------

const formSchema = fallEventBaseObjectSchema.omit({ firmaPin: true });
type FormValues = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// Etiquetas en español
// ---------------------------------------------------------------------------

const LUGAR_LABELS: Record<typeof FALL_LUGAR[number], string> = {
  cama:     "Cama",
  baño:     "Baño",
  pasillo:  "Pasillo",
  silla:    "Silla",
  otro:     "Otro",
};

const TESTIGO_LABELS: Record<typeof FALL_TESTIGO_TIPO[number], string> = {
  familiar:          "Familiar",
  enfermera:         "Enfermera",
  personal_apoyo:    "Personal de apoyo",
  otro_paciente:     "Otro paciente",
  sin_testigo:       "Sin testigo",
};

const LESION_LABELS: Record<typeof FALL_LESION[number], string> = {
  ninguna:   "Ninguna",
  leve:      "Leve",
  moderada:  "Moderada",
  grave:     "Grave",
  muy_grave: "Muy grave",
};

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function FallEventNuevoPage() {
  const router = useRouter();
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);
  const [morseScore, setMorseScore] = useState<number | null>(null);

  const recordMutation = trpc.eceFallEvent.record.useMutation({
    onSuccess: () => {
      router.push("/ece/fall-event");
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      testigoPresente:        false,
      requirioAtencionMedica: false,
    },
  });

  const watchedLugar          = watch("lugar");
  const watchedTestigoPresente = watch("testigoPresente");

  // TODO: auto-lookup del último Morse cuando exista
  // `trpc.eceSignosVitales.lastMorse` — por ahora el morseScore
  // queda en `null` y la sección FallRiskInterventions no se renderiza.
  void setMorseScore;

  function onValidSubmit(values: FormValues) {
    setPendingValues(values);
    setPinModalOpen(true);
  }

  function handlePinConfirm(pin: string) {
    if (!pendingValues) return;
    recordMutation.mutate({ ...pendingValues, firmaPin: pin });
    setPinModalOpen(false);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-xl font-semibold text-gray-900">Registrar Evento de Caída</h1>
      <p className="text-sm text-gray-500">JCI IPSG.6 ME 4 — todos los campos son obligatorios salvo indicación.</p>

      {/* Protocolo de intervenciones según Morse */}
      {morseScore !== null && (
        <FallRiskInterventions morseScore={morseScore} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos del evento</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(onValidSubmit)}
            className="space-y-4"
            aria-label="Formulario de reporte de caída"
            noValidate
          >
            {/* ID Paciente */}
            <div className="space-y-1">
              <Label htmlFor="pacienteId">ID Paciente (UUID)</Label>
              <Input
                id="pacienteId"
                {...register("pacienteId")}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-describedby="pacienteId-error"
                aria-invalid={!!errors.pacienteId}
              />
              {errors.pacienteId && (
                <p id="pacienteId-error" role="alert" className="text-sm text-red-600">
                  {errors.pacienteId.message}
                </p>
              )}
            </div>

            {/* ID Episodio */}
            <div className="space-y-1">
              <Label htmlFor="episodioId">ID Episodio Hospitalario (UUID)</Label>
              <Input
                id="episodioId"
                {...register("episodioId")}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-describedby="episodioId-error"
                aria-invalid={!!errors.episodioId}
              />
              {errors.episodioId && (
                <p id="episodioId-error" role="alert" className="text-sm text-red-600">
                  {errors.episodioId.message}
                </p>
              )}
            </div>

            {/* Fecha y hora */}
            <div className="space-y-1">
              <Label htmlFor="fechaHora">Fecha y hora de la caída</Label>
              <Input
                id="fechaHora"
                type="datetime-local"
                {...register("fechaHora")}
                aria-invalid={!!errors.fechaHora}
              />
            </div>

            {/* Lugar */}
            <div className="space-y-1">
              <Label htmlFor="lugar">Lugar de la caída</Label>
              <Select onValueChange={(v) => setValue("lugar", v as typeof FALL_LUGAR[number])}>
                <SelectTrigger id="lugar" aria-invalid={!!errors.lugar}>
                  <SelectValue placeholder="Seleccione..." />
                </SelectTrigger>
                <SelectContent>
                  {FALL_LUGAR.map((l) => (
                    <SelectItem key={l} value={l}>{LUGAR_LABELS[l]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.lugar && (
                <p role="alert" className="text-sm text-red-600">{errors.lugar.message}</p>
              )}
            </div>

            {/* Lugar otro — condicional */}
            {watchedLugar === "otro" && (
              <div className="space-y-1">
                <Label htmlFor="lugarOtro">Especifique el lugar</Label>
                <Input
                  id="lugarOtro"
                  {...register("lugarOtro")}
                  aria-required="true"
                  aria-invalid={!!errors.lugarOtro}
                />
                {errors.lugarOtro && (
                  <p role="alert" className="text-sm text-red-600">{errors.lugarOtro.message}</p>
                )}
              </div>
            )}

            {/* Testigo presente */}
            <div className="flex items-center gap-2">
              <input
                id="testigoPresente"
                type="checkbox"
                {...register("testigoPresente")}
                className="h-4 w-4"
              />
              <Label htmlFor="testigoPresente">Testigo presente</Label>
            </div>

            {/* Tipo de testigo — condicional */}
            {watchedTestigoPresente && (
              <div className="space-y-1">
                <Label htmlFor="testigoTipo">Tipo de testigo</Label>
                <Select onValueChange={(v) => setValue("testigoTipo", v as typeof FALL_TESTIGO_TIPO[number])}>
                  <SelectTrigger id="testigoTipo">
                    <SelectValue placeholder="Seleccione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {FALL_TESTIGO_TIPO.map((t) => (
                      <SelectItem key={t} value={t}>{TESTIGO_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Circunstancia */}
            <div className="space-y-1">
              <Label htmlFor="circunstancia">Circunstancia de la caída</Label>
              <textarea
                id="circunstancia"
                {...register("circunstancia")}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-invalid={!!errors.circunstancia}
              />
              {errors.circunstancia && (
                <p role="alert" className="text-sm text-red-600">{errors.circunstancia.message}</p>
              )}
            </div>

            {/* Lesión resultante */}
            <div className="space-y-1">
              <Label htmlFor="lesionResultante">Lesión resultante</Label>
              <Select onValueChange={(v) => setValue("lesionResultante", v as typeof FALL_LESION[number])}>
                <SelectTrigger id="lesionResultante" aria-invalid={!!errors.lesionResultante}>
                  <SelectValue placeholder="Seleccione..." />
                </SelectTrigger>
                <SelectContent>
                  {FALL_LESION.map((l) => (
                    <SelectItem key={l} value={l}>{LESION_LABELS[l]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.lesionResultante && (
                <p role="alert" className="text-sm text-red-600">{errors.lesionResultante.message}</p>
              )}
            </div>

            {/* Requirió atención médica */}
            <div className="flex items-center gap-2">
              <input
                id="requirioAtencionMedica"
                type="checkbox"
                {...register("requirioAtencionMedica")}
                className="h-4 w-4"
              />
              <Label htmlFor="requirioAtencionMedica">Requirió atención médica inmediata</Label>
            </div>

            {/* Intervención aplicada */}
            <div className="space-y-1">
              <Label htmlFor="intervencionAplicada">Intervención aplicada (opcional)</Label>
              <textarea
                id="intervencionAplicada"
                {...register("intervencionAplicada")}
                rows={2}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Morse previa — readonly, llenado por lookup */}
            {morseScore !== null && (
              <div className="space-y-1">
                <Label>Puntaje Morse previo (auto-cargado)</Label>
                <Input value={morseScore} readOnly className="bg-gray-50" />
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              className="w-full"
              disabled={recordMutation.isPending}
              aria-busy={recordMutation.isPending}
            >
              {recordMutation.isPending ? "Guardando..." : "Registrar caída y firmar"}
            </Button>

            {recordMutation.error && (
              <p role="alert" className="text-sm text-red-600">
                {recordMutation.error.message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Modal PIN */}
      {pinModalOpen && (
        <PinDialog
          titulo="Firmar reporte de caída — JCI IPSG.6 ME 4"
          onConfirm={async (pin) => {
            handlePinConfirm(pin);
          }}
          onCancel={() => setPinModalOpen(false)}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// PinDialog inline — mismo patrón usado en /ece/defuncion/[id]/page.tsx
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
