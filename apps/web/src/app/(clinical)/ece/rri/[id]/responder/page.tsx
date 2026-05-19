"use client";

/**
 * ECE — Formulario respuesta IC para RRI.
 * Rol IC: completa respuesta y firma con PIN.
 * Solo accesible cuando estado=firmado.
 *
 * HD-25 (S1): respuesta → respuesta_interconsultante.
 *   Campos diagnostico y plan eliminados (no existen en ece.rri).
 *   El IC puede incluir diagnóstico CIE-10 y plan dentro del campo
 *   respuestaInterconsultante (texto libre, max 4000 chars).
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

export default function RriResponderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const { data: rri, isLoading, error: loadError } = trpc.eceRri.get.useQuery({ id });
  const responderMutation = trpc.eceRri.responder.useMutation();

  const [form, setForm] = React.useState({
    respuestaInterconsultante: "",
    pin: "",
  });
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const patch = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const isValid =
    form.respuestaInterconsultante.trim().length > 0 &&
    form.pin.length >= 6;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitError(null);

    try {
      await responderMutation.mutateAsync({
        rriId: id,
        respuestaInterconsultante: form.respuestaInterconsultante,
        pin: form.pin,
      });
      router.push(`/ece/rri/${id}`);
    } catch (err) {
      setSubmitError(
        (err as { message?: string })?.message ??
          "Error al guardar la respuesta.",
      );
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {loadError.message}
      </p>
    );
  }

  if (!rri) return null;

  if (rri.estado_codigo !== "firmado") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Respuesta IC</h1>
        <p role="alert" className="text-sm text-destructive">
          Esta RRI no esta en estado &quot;firmado&quot; (estado actual: {rri.estado_codigo}).
          Solo se puede responder cuando el MC ha firmado la solicitud.
        </p>
        <Button variant="outline" onClick={() => router.back()}>
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ArrowLeftRight className="h-6 w-6" aria-hidden />
          Respuesta IC — {rri.tipo}
        </h1>
        <p className="text-sm text-muted-foreground">
          Complete la respuesta y firme con su PIN. El estado avanzara a &quot;validado&quot;.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la solicitud</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Tipo</dt>
              <dd className="capitalize">{rri.tipo}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs text-muted-foreground">Motivo</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{rri.motivo}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs text-muted-foreground">Resumen clinico</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{rri.resumen_clinico}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Respuesta del interconsultante</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="respuesta-ic">
                Respuesta <span aria-hidden className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Incluya diagnóstico CIE-10 y plan de manejo en este campo.
              </p>
              <textarea
                id="respuesta-ic"
                rows={6}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Descripcion detallada: diagnóstico (ej. K35.2), plan de manejo, indicaciones de seguimiento…"
                maxLength={4000}
                value={form.respuestaInterconsultante}
                onChange={(e) => patch("respuestaInterconsultante", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pin-ic">
                PIN de firma electronica (IC){" "}
                <span aria-hidden className="text-destructive">*</span>
              </Label>
              <Input
                id="pin-ic"
                type="password"
                inputMode="numeric"
                placeholder="6-8 digitos"
                value={form.pin}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                  patch("pin", digits);
                  setSubmitError(null);
                }}
                disabled={responderMutation.isPending}
                className="tracking-widest text-center text-lg max-w-xs"
              />
            </div>

            {submitError && (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={responderMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!isValid || responderMutation.isPending}
              >
                {responderMutation.isPending ? "Firmando…" : "Firmar y validar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
