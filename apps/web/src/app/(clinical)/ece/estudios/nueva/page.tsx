"use client";

/**
 * ECE — Nueva Solicitud de Estudio (Doc 18 NTEC).
 *
 * Formulario: episodioId + tipo + examenes (códigos LOINC separados por coma)
 * + prioridad + indicacionClinica + PIN de firma MC.
 *
 * La solicitud se crea y firma en un solo paso para mantener la UX simple.
 * Patrón: React.useState (sin react-hook-form, consistente con el resto del repo).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type TipoEstudio = "laboratorio" | "imagenologia" | "otro";
type Prioridad = "rutina" | "urgente" | "stat";

interface FieldErrors {
  episodioId?: string;
  estudiosRaw?: string;
  pin?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_RE = /^\d{6,8}$/;
// HH-04: formato LOINC canónico — 1-5 dígitos, guion, 1 dígito verificador.
const LOINC_RE = /^\d{1,5}-\d$/;

function validate(episodioId: string, estudiosRaw: string, pin: string): FieldErrors {
  const errs: FieldErrors = {};
  if (!UUID_RE.test(episodioId.trim())) errs.episodioId = "Debe ser un UUID válido";
  const codigos = estudiosRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (codigos.length === 0) {
    errs.estudiosRaw = "Ingrese al menos un código de estudio";
  } else {
    const invalidos = codigos.filter((c) => !LOINC_RE.test(c));
    if (invalidos.length > 0) {
      errs.estudiosRaw = `Código(s) LOINC inválido(s): ${invalidos.join(", ")}. Formato requerido: NNNNN-N`;
    }
  }
  if (!PIN_RE.test(pin)) errs.pin = "PIN debe ser 6-8 dígitos";
  return errs;
}

export default function NuevaSolicitudEstudioPage() {
  const router = useRouter();

  const [episodioId, setEpisodioId] = React.useState("");
  const [tipo, setTipo] = React.useState<TipoEstudio>("laboratorio");
  const [estudiosRaw, setEstudiosRaw] = React.useState("");
  const [prioridad, setPrioridad] = React.useState<Prioridad>("rutina");
  const [observaciones, setObservaciones] = React.useState("");
  const [pin, setPin] = React.useState("");

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const createMutation = trpc.eceSolicitudEstudio.create.useMutation();
  const firmarMutation = trpc.eceSolicitudEstudio.firmar.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const errs = validate(episodioId, estudiosRaw, pin);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const examenes = estudiosRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const { solicitudId } = await createMutation.mutateAsync({
        episodioId: episodioId.trim(),
        tipo,
        examenes,
        prioridad,
        indicacionClinica: observaciones.trim() || undefined,
      });
      await firmarMutation.mutateAsync({ solicitudId, pin });
      router.push(`/ece/estudios/${solicitudId}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Nueva solicitud de estudio</h1>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la solicitud</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="episodioId">Episodio (UUID) *</Label>
              <Input
                id="episodioId"
                placeholder="xxxxxxxx-xxxx-…"
                data-testid="input-episodio-id"
                value={episodioId}
                onChange={(e) => setEpisodioId(e.target.value)}
              />
              {fieldErrors.episodioId && (
                <p className="text-sm text-destructive">{fieldErrors.episodioId}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo de estudio *</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoEstudio)}>
                <SelectTrigger id="tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="laboratorio">Laboratorio</SelectItem>
                  <SelectItem value="imagenologia">Imagenología</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="estudiosRaw">
                Estudios solicitados * (códigos separados por coma)
              </Label>
              <Input
                id="estudiosRaw"
                placeholder="Ej: 2093-3, 2075-0, 718-7"
                value={estudiosRaw}
                onChange={(e) => setEstudiosRaw(e.target.value)}
              />
              {fieldErrors.estudiosRaw && (
                <p className="text-sm text-destructive">{fieldErrors.estudiosRaw}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prioridad">Prioridad *</Label>
              <Select value={prioridad} onValueChange={(v) => setPrioridad(v as Prioridad)}>
                <SelectTrigger id="prioridad">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rutina">Rutina</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                  <SelectItem value="stat">STAT</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="observaciones">Indicación clínica</Label>
              <Textarea
                id="observaciones"
                rows={3}
                placeholder="Contexto clínico relevante…"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </div>

            <div className="space-y-1.5 rounded-md border border-amber-400/40 bg-amber-50 p-3 dark:bg-amber-950/20">
              <Label htmlFor="pin">PIN de firma electrónica MC *</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="6-8 dígitos"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
              {fieldErrors.pin && (
                <p className="text-sm text-destructive">{fieldErrors.pin}</p>
              )}
              <p className="text-xs text-muted-foreground">
                La solicitud se creará y firmará en un solo paso.
              </p>
            </div>

            {serverError && (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Guardando…" : "Crear y firmar solicitud"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
