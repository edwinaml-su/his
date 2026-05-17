"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

interface FormState {
  campo: string;
  valorAnterior: string;
  valorPropuesto: string;
  motivo: string;
}

interface FormErrors {
  campo?: string;
  valorAnterior?: string;
  valorPropuesto?: string;
  motivo?: string;
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.campo.trim()) errors.campo = "Requerido.";
  if (form.campo.length > 200) errors.campo = "Máximo 200 caracteres.";
  if (!form.valorAnterior.trim()) errors.valorAnterior = "Requerido.";
  if (form.valorAnterior.length > 2000) errors.valorAnterior = "Máximo 2000 caracteres.";
  if (!form.valorPropuesto.trim()) errors.valorPropuesto = "Requerido.";
  if (form.valorPropuesto.length > 2000) errors.valorPropuesto = "Máximo 2000 caracteres.";
  if (form.motivo.trim().length < 10) errors.motivo = "Mínimo 10 caracteres.";
  if (form.motivo.length > 1000) errors.motivo = "Máximo 1000 caracteres.";
  return errors;
}

/**
 * ECE — Formulario de nueva solicitud de rectificación.
 * Recibe documentoInstanciaId por query param.
 */
export default function NuevaRectificacionPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const docId = searchParams.get("documentoInstanciaId") ?? "";

  const [form, setForm] = React.useState<FormState>({
    campo: "",
    valorAnterior: "",
    valorPropuesto: "",
    motivo: "",
  });
  const [errors, setErrors] = React.useState<FormErrors>({});

  const solicitar = trpc.eceRectificacion.solicitar.useMutation({
    onSuccess: () => {
      router.push(`/ece/rectificaciones?documentoInstanciaId=${docId}`);
    },
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    solicitar.mutate({
      documentoInstanciaId: docId,
      ...form,
    });
  }

  if (!docId) {
    return (
      <p className="text-sm text-destructive">
        Falta el parámetro documentoInstanciaId. Accede desde un documento firmado.
      </p>
    );
  }

  const textareaCls =
    "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva solicitud de rectificación</h1>
        <p className="text-sm text-muted-foreground">
          NTEC Art. 41 — El documento original no se modifica.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la rectificación</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="campo">Campo a rectificar</Label>
              <Input
                id="campo"
                placeholder="Ej: diagnostico_principal"
                aria-invalid={!!errors.campo}
                aria-describedby={errors.campo ? "campo-error" : undefined}
                value={form.campo}
                onChange={(e) => update("campo", e.target.value)}
              />
              {errors.campo && (
                <p id="campo-error" role="alert" className="text-xs text-destructive">
                  {errors.campo}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="valorAnterior">Valor anterior (original)</Label>
              <textarea
                id="valorAnterior"
                rows={3}
                className={textareaCls}
                aria-invalid={!!errors.valorAnterior}
                aria-describedby={errors.valorAnterior ? "valorAnterior-error" : undefined}
                value={form.valorAnterior}
                onChange={(e) => update("valorAnterior", e.target.value)}
              />
              {errors.valorAnterior && (
                <p id="valorAnterior-error" role="alert" className="text-xs text-destructive">
                  {errors.valorAnterior}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="valorPropuesto">Valor propuesto (corrección)</Label>
              <textarea
                id="valorPropuesto"
                rows={3}
                className={textareaCls}
                aria-invalid={!!errors.valorPropuesto}
                aria-describedby={errors.valorPropuesto ? "valorPropuesto-error" : undefined}
                value={form.valorPropuesto}
                onChange={(e) => update("valorPropuesto", e.target.value)}
              />
              {errors.valorPropuesto && (
                <p id="valorPropuesto-error" role="alert" className="text-xs text-destructive">
                  {errors.valorPropuesto}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="motivo">Motivo de la rectificación</Label>
              <textarea
                id="motivo"
                rows={3}
                className={textareaCls}
                placeholder="Mínimo 10 caracteres."
                aria-invalid={!!errors.motivo}
                aria-describedby={errors.motivo ? "motivo-error" : undefined}
                value={form.motivo}
                onChange={(e) => update("motivo", e.target.value)}
              />
              {errors.motivo && (
                <p id="motivo-error" role="alert" className="text-xs text-destructive">
                  {errors.motivo}
                </p>
              )}
            </div>

            {solicitar.error && (
              <p role="alert" className="text-sm text-destructive">
                {solicitar.error.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  router.push(`/ece/rectificaciones?documentoInstanciaId=${docId}`)
                }
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={solicitar.isPending}>
                Enviar solicitud
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
