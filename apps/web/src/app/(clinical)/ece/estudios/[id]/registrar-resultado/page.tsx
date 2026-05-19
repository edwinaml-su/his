"use client";

/**
 * ECE — Registrar resultado de estudio (Doc 18 NTEC).
 *
 * Visible para roles TEC / PROF_DX / MC / ESP.
 * La precondición (solicitud firmada o validada) la enforcea el backend.
 *
 * valores: objeto JSON con los resultados analíticos (ej. { glucosa: 95, unidad: "mg/dL" }).
 * El formulario acepta texto libre en formato JSON para máxima flexibilidad.
 * La interpretación es opcional.
 *
 * Patrón: React.useState (sin react-hook-form, consistente con el resto del repo).
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import { trpc } from "@/lib/trpc/react";

interface FieldErrors {
  valores?: string;
}

function validate(valoresRaw: string): FieldErrors {
  const errs: FieldErrors = {};
  if (!valoresRaw.trim()) {
    errs.valores = "Los valores del resultado son obligatorios";
    return errs;
  }
  try {
    JSON.parse(valoresRaw.trim());
  } catch {
    errs.valores = "Debe ser un objeto JSON válido (ej. {\"glucosa\": 95})";
  }
  return errs;
}

export default function RegistrarResultadoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [valoresRaw, setValoresRaw] = React.useState("");
  const [interpretacion, setInterpretacion] = React.useState("");

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const registrarMutation = trpc.eceResultadoEstudio.registrar.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const errs = validate(valoresRaw);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      await registrarMutation.mutateAsync({
        solicitudId: params.id,
        valores: JSON.parse(valoresRaw.trim()) as Record<string, unknown>,
        interpretacion: interpretacion.trim() || undefined,
      });
      router.push(`/ece/estudios/${params.id}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Error al registrar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Registrar resultado de estudio</h1>

      <Card>
        <CardHeader>
          <CardTitle>Datos del resultado</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="valores">Valores del resultado * (JSON)</Label>
              <Textarea
                id="valores"
                rows={5}
                placeholder={`{\n  "glucosa": 95,\n  "unidad": "mg/dL"\n}`}
                data-testid="input-valores"
                value={valoresRaw}
                onChange={(e) => setValoresRaw(e.target.value)}
                className="font-mono text-xs"
              />
              {fieldErrors.valores && (
                <p className="text-sm text-destructive">{fieldErrors.valores}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Ingrese un objeto JSON con los resultados analíticos del estudio.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="interpretacion">Interpretación / conclusión</Label>
              <Textarea
                id="interpretacion"
                rows={3}
                placeholder="Interpretación clínica del resultado…"
                value={interpretacion}
                onChange={(e) => setInterpretacion(e.target.value)}
              />
            </div>

            {serverError && (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Registrando…" : "Registrar resultado"}
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
