"use client";

/**
 * ECE — Nueva Orden de Ingreso (ORD_ING, NTEC Art. 33).
 *
 * CC-0005 RF-1: identificación de paciente por tipo+número de documento
 *   (resuelve al paciente/expediente en tiempo real; no UUID manual).
 * CC-0005 RF-2: diagnósticos CIE-11 con buscador compartido;
 *   exactamente un diagnóstico PRINCIPAL requerido.
 *
 * Flujo: formulario → "Crear y firmar" → PinDialog → create + firmar.
 */
import { useState, useId, type FormEvent } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
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
import { BuscadorCie11 } from "@/components/cie11/BuscadorCie11";
import {
  ordenIngresoCreateInput,
  MODALIDAD_ING,
  MOTIVO_INGRESO_TIPO,
  PROCEDENCIA,
  TIPO_DX_INGRESO,
} from "@his/contracts/schemas/orden-ingreso";
import { validateDUI } from "@his/contracts";

// ─── Schema form (sin firmaPin — lo captura el modal) ─────────────────────────

const formSchema = ordenIngresoCreateInput;
type FormValues = z.infer<typeof formSchema>;

// ─── Labels en español ────────────────────────────────────────────────────────

const MODALIDAD_LABELS: Record<(typeof MODALIDAD_ING)[number], string> = {
  hospitalizacion: "Hospitalización",
  hospital_de_dia: "Hospital de día",
};

const MOTIVO_TIPO_LABELS: Record<(typeof MOTIVO_INGRESO_TIPO)[number], string> = {
  cirugia:         "Cirugía",
  emergencia:      "Emergencia",
  hospitalizacion: "Hospitalización médica",
  obs:             "Obstetricia",
  otro:            "Otro",
};

const PROCEDENCIA_LABELS: Record<(typeof PROCEDENCIA)[number], string> = {
  consulta_externa:  "Consulta externa",
  emergencia:        "Emergencia",
  traslado_externo:  "Traslado externo",
  traslado_interno:  "Traslado interno",
  espontaneo:        "Espontáneo",
  otro:              "Otro",
};

const TIPO_DX_LABELS: Record<(typeof TIPO_DX_INGRESO)[number], string> = {
  PRINCIPAL:   "Principal",
  SECUNDARIO:  "Secundario",
};

// CC-0005: tipos de documento disponibles para resolver paciente en OI.
const DOCUMENTO_TIPO_OPTIONS = [
  { value: "DUI",               label: "DUI" },
  { value: "CARNET_RESIDENCIA", label: "Carnet de residencia" },
  { value: "PASAPORTE",         label: "Pasaporte" },
  { value: "DUI_RESP",          label: "DUI responsable (menor)" },
] as const;

// Regex de validación por tipo de documento (lado cliente, UI-only).
function validarDocumentoNumero(tipo: string, numero: string): string | null {
  if (!numero.trim()) return "Número de documento requerido.";
  if (tipo === "DUI" || tipo === "DUI_RESP") {
    if (!validateDUI(numero)) return "DUI inválido (dígito verificador).";
  } else {
    // CARNET_RESIDENCIA / PASAPORTE: alfanumérico 6-20
    if (!/^[A-Z0-9]{6,20}$/i.test(numero.trim())) {
      return "Número inválido (6-20 caracteres alfanuméricos).";
    }
  }
  return null;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function OrdenIngresoNuevoPage() {
  const router = useRouter();
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);
  const [pacienteResuelto, setPacienteResuelto] = useState<{
    displayName: string;
    expediente: string | null;
  } | null>(null);
  const [docTipoLocal, setDocTipoLocal] = useState<string>("");
  const [docNumeroLocal, setDocNumeroLocal] = useState<string>("");
  const [docError, setDocError] = useState<string | null>(null);

  const createMutation = trpc.eceOrdenIngreso.create.useMutation();
  const firmarMutation = trpc.eceOrdenIngreso.firmar.useMutation({
    onSuccess: (_, vars) => {
      router.push(`/ece/orden-ingreso/${vars.id}`);
    },
  });

  const findByDocMutation = trpc.patient.findByDocument.useQuery(
    // Cast necesario: el tipo de docTipoLocal es string en estado local; el enum
    // es validado en server-side. El refetch solo ocurre tras validación UI.
    { documentType: docTipoLocal as "DUI", documentNumber: docNumeroLocal },
    { enabled: false },
  );

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

  // ─── Resolver paciente por documento ─────────────────────────────────────────

  async function handleBuscarPaciente() {
    if (!docTipoLocal) { setDocError("Seleccione un tipo de documento."); return; }
    const err = validarDocumentoNumero(docTipoLocal, docNumeroLocal);
    if (err) { setDocError(err); return; }
    setDocError(null);

    const result = await findByDocMutation.refetch();
    const data = result.data;

    setValue("documentoTipo", docTipoLocal as FormValues["documentoTipo"]);
    setValue("documentoNumero", docNumeroLocal);

    if (data) {
      setValue("pacienteId", data.id);
      setPacienteResuelto({ displayName: data.displayName, expediente: data.expediente ?? null });
    } else {
      // No encontrado — limpiar pacienteId para que Zod falle si se intenta enviar
      setValue("pacienteId", "");
      setPacienteResuelto(null);
    }
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────

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

  // Diagnósticos: error global de refine (array-level)
  const diagError =
    errors.diagnosticoIngreso?.root?.message ??
    (errors.diagnosticoIngreso as { message?: string } | undefined)?.message;

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
            {/* ── CC-0005 RF-1: Selector de documento ─────────────────────────── */}
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Identificación del paciente</p>
              <div className="flex gap-2">
                <div className="w-52">
                  <Label htmlFor="doc-tipo">Tipo de documento</Label>
                  <Select
                    onValueChange={(v) => {
                      setDocTipoLocal(v);
                      setDocError(null);
                      setPacienteResuelto(null);
                    }}
                  >
                    <SelectTrigger id="doc-tipo">
                      <SelectValue placeholder="Tipo..." />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENTO_TIPO_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label htmlFor="doc-numero">Número de documento</Label>
                  <Input
                    id="doc-numero"
                    value={docNumeroLocal}
                    onChange={(e) => {
                      setDocNumeroLocal(e.target.value);
                      setDocError(null);
                      setPacienteResuelto(null);
                    }}
                    placeholder={
                      docTipoLocal === "DUI" || docTipoLocal === "DUI_RESP"
                        ? "########-#"
                        : "Alfanumérico 6-20"
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBuscarPaciente}
                    disabled={findByDocMutation.isFetching}
                  >
                    {findByDocMutation.isFetching ? "Buscando…" : "Buscar"}
                  </Button>
                </div>
              </div>

              {docError && <p role="alert" className="text-sm text-red-600">{docError}</p>}

              {pacienteResuelto && (
                <p className="text-sm text-green-700">
                  Paciente: <strong>{pacienteResuelto.displayName}</strong>
                  {pacienteResuelto.expediente && (
                    <span className="ml-1 text-muted-foreground">
                      · Exp: {pacienteResuelto.expediente}
                    </span>
                  )}
                </p>
              )}

              {findByDocMutation.data === null && !docError && !pacienteResuelto && !findByDocMutation.isFetching && (
                <p className="text-sm text-yellow-700">
                  Paciente no encontrado con ese documento. Verifique los datos.
                </p>
              )}

              {/* pacienteId oculto — gestionado por el resolver */}
              <input type="hidden" {...register("pacienteId")} />
              <input type="hidden" {...register("documentoTipo")} />
              <input type="hidden" {...register("documentoNumero")} />
              {errors.pacienteId && (
                <p role="alert" className="text-sm text-red-600">
                  Debe buscar y resolver un paciente antes de continuar.
                </p>
              )}
            </div>

            {/* Episodio origen (opcional) */}
            <FieldGroup label="ID Episodio origen (opcional)" error={errors.episodioOrigenId?.message}>
              {(id) => (
                <Input
                  id={id}
                  {...register("episodioOrigenId")}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              )}
            </FieldGroup>

            {/* Médico que ordena */}
            <FieldGroup label="ID Médico que ordena (UUID)" error={errors.medicoOrdena?.message}>
              {(id) => (
                <Input
                  id={id}
                  {...register("medicoOrdena")}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  aria-invalid={!!errors.medicoOrdena}
                />
              )}
            </FieldGroup>

            {/* Fecha/hora orden */}
            <FieldGroup label="Fecha y hora de la orden" error={errors.fechaHoraOrden?.message}>
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  {...register("fechaHoraOrden")}
                  aria-invalid={!!errors.fechaHoraOrden}
                />
              )}
            </FieldGroup>

            {/* Modalidad */}
            <FieldGroup label="Modalidad" error={errors.modalidad?.message}>
              {(id) => (
                <Select onValueChange={(v) => setValue("modalidad", v as (typeof MODALIDAD_ING)[number])}>
                  <SelectTrigger id={id} aria-invalid={!!errors.modalidad}>
                    <SelectValue placeholder="Seleccione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {MODALIDAD_ING.map((m) => (
                      <SelectItem key={m} value={m}>{MODALIDAD_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldGroup>

            {/* Motivo tipo */}
            <FieldGroup label="Tipo de motivo" error={errors.motivoIngresoTipo?.message}>
              {(id) => (
                <Select onValueChange={(v) => setValue("motivoIngresoTipo", v as (typeof MOTIVO_INGRESO_TIPO)[number])}>
                  <SelectTrigger id={id} aria-invalid={!!errors.motivoIngresoTipo}>
                    <SelectValue placeholder="Seleccione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {MOTIVO_INGRESO_TIPO.map((t) => (
                      <SelectItem key={t} value={t}>{MOTIVO_TIPO_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldGroup>

            {/* Procedencia */}
            <FieldGroup label="Procedencia" error={errors.procedencia?.message}>
              {(id) => (
                <Select onValueChange={(v) => setValue("procedencia", v as (typeof PROCEDENCIA)[number])}>
                  <SelectTrigger id={id} aria-invalid={!!errors.procedencia}>
                    <SelectValue placeholder="Seleccione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PROCEDENCIA.map((p) => (
                      <SelectItem key={p} value={p}>{PROCEDENCIA_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldGroup>

            {/* Servicio de ingreso */}
            <FieldGroup label="ID Servicio de ingreso (opcional)" error={errors.servicioIngresoId?.message}>
              {(id) => (
                <Input id={id} {...register("servicioIngresoId")} placeholder="UUID del servicio" />
              )}
            </FieldGroup>

            {/* Motivo de ingreso */}
            <FieldGroup label="Motivo de ingreso" error={errors.motivoIngreso?.message}>
              {(id) => (
                <textarea
                  id={id}
                  {...register("motivoIngreso")}
                  rows={3}
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Descripción clínica del motivo de ingreso (mín. 10 caracteres)..."
                  aria-invalid={!!errors.motivoIngreso}
                />
              )}
            </FieldGroup>

            {/* Circunstancia de ingreso */}
            <FieldGroup label="Circunstancia del ingreso" error={errors.circunstanciaIngreso?.message}>
              {(id) => (
                <textarea
                  id={id}
                  {...register("circunstanciaIngreso")}
                  rows={3}
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Contexto clínico del ingreso..."
                  aria-invalid={!!errors.circunstanciaIngreso}
                />
              )}
            </FieldGroup>

            {/* ── CC-0005 RF-2: Diagnósticos CIE-11 ────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  Diagnósticos de ingreso{" "}
                  <span className="text-xs text-muted-foreground">(exactamente 1 principal)</span>
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    appendDiag({
                      cie11Codigo: "",
                      cie11Titulo: "",
                      cie11Uri: undefined,
                      version: undefined,
                      tipo: diagFields.length === 0 ? "PRINCIPAL" : "SECUNDARIO",
                    })
                  }
                >
                  Agregar diagnóstico
                </Button>
              </div>

              {diagError && (
                <p role="alert" className="text-sm text-red-600">{diagError}</p>
              )}

              {diagFields.map((field, index) => (
                <div key={field.id} className="rounded border p-3 space-y-2">
                  <BuscadorCie11
                    id={`cie11-${index}`}
                    onSelect={(item) => {
                      setValue(`diagnosticoIngreso.${index}.cie11Codigo`, item.codigo);
                      setValue(`diagnosticoIngreso.${index}.cie11Titulo`, item.titulo);
                      if (item.uri) setValue(`diagnosticoIngreso.${index}.cie11Uri`, item.uri);
                    }}
                  />
                  <div className="flex gap-2 items-end">
                    <div className="w-28">
                      <Label htmlFor={`dx-codigo-${index}`} className="text-xs">Código CIE-11</Label>
                      <Input
                        id={`dx-codigo-${index}`}
                        {...register(`diagnosticoIngreso.${index}.cie11Codigo`)}
                        placeholder="Ej. CA40.0"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="flex-1">
                      <Label htmlFor={`dx-titulo-${index}`} className="text-xs">Título</Label>
                      <Input
                        id={`dx-titulo-${index}`}
                        {...register(`diagnosticoIngreso.${index}.cie11Titulo`)}
                        placeholder="Título del diagnóstico"
                      />
                    </div>
                    <div className="w-36">
                      <Label className="text-xs">Tipo</Label>
                      <Controller
                        control={control}
                        name={`diagnosticoIngreso.${index}.tipo`}
                        render={({ field: f }) => (
                          <Select value={f.value} onValueChange={f.onChange}>
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIPO_DX_INGRESO.map((t) => (
                                <SelectItem key={t} value={t} className="text-xs">
                                  {TIPO_DX_LABELS[t]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDiag(index)}
                    >
                      Quitar
                    </Button>
                  </div>
                  {errors.diagnosticoIngreso?.[index]?.cie11Codigo && (
                    <p role="alert" className="text-xs text-red-600">
                      {errors.diagnosticoIngreso[index]!.cie11Codigo!.message}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Reserva sala quirúrgica — solo visible si cirugia */}
            {watchedMotivoTipo === "cirugia" && (
              <FieldGroup label="ID Reserva sala quirúrgica (UUID)" error={errors.reservaSalaQxId?.message}>
                {(id) => (
                  <Input
                    id={id}
                    {...register("reservaSalaQxId")}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                )}
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
  children: (id: string) => React.ReactNode;
}) {
  const fieldId = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={fieldId}>{label}</Label>
      {children(fieldId)}
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
