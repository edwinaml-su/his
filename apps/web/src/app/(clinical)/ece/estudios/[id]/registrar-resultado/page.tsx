"use client";

/**
 * ECE — Registrar resultado de estudio (Doc 18 NTEC).
 *
 * Visible para roles TEC / PROF_DX / MC / ESP.
 * La precondición (solicitud firmada o validada) la enforcea el backend.
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
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import { trpc } from "@/lib/trpc/react";

const URL_RE = /^https?:\/\/.+/;

interface FieldErrors {
  resultado?: string;
  adjuntoUri?: string;
}

function validate(resultado: string, adjuntoUri: string): FieldErrors {
  const errs: FieldErrors = {};
  if (!resultado.trim()) errs.resultado = "El resultado es obligatorio";
  if (adjuntoUri.trim() && !URL_RE.test(adjuntoUri.trim())) {
    errs.adjuntoUri = "Debe ser una URL válida";
  }
  return errs;
}

export default function RegistrarResultadoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [resultado, setResultado] = React.useState("");
  const [interpretacion, setInterpretacion] = React.useState("");
  const [adjuntoUri, setAdjuntoUri] = React.useState("");

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const registrarMutation = trpc.eceResultadoEstudio.registrar.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const errs = validate(resultado, adjuntoUri);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      await registrarMutation.mutateAsync({
        solicitudId: params.id,
        resultado: resultado.trim(),
        interpretacion: interpretacion.trim() || undefined,
        adjuntoUri: adjuntoUri.trim() || undefined,
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
              <Label htmlFor="resultado">Resultado *</Label>
              <Textarea
                id="resultado"
                rows={5}
                placeholder="Describe los hallazgos del estudio…"
                data-testid="input-resultado"
                value={resultado}
                onChange={(e) => setResultado(e.target.value)}
              />
              {fieldErrors.resultado && (
                <p className="text-sm text-destructive">{fieldErrors.resultado}</p>
              )}
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

            <div className="space-y-1.5">
              <Label htmlFor="adjuntoUri">URL adjunto (PDF / imagen)</Label>
              <Input
                id="adjuntoUri"
                type="url"
                placeholder="https://storage.example.com/resultado.pdf"
                value={adjuntoUri}
                onChange={(e) => setAdjuntoUri(e.target.value)}
              />
              {fieldErrors.adjuntoUri && (
                <p className="text-sm text-destructive">{fieldErrors.adjuntoUri}</p>
              )}
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
