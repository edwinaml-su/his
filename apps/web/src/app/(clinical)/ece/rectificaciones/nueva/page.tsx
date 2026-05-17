"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import { trpc } from "@/lib/trpc/react";

const solicitarInputSchema = z.object({
  documentoInstanciaId: z.string().uuid(),
  campo: z.string().min(1).max(200),
  valorAnterior: z.string().min(1).max(2000),
  valorPropuesto: z.string().min(1).max(2000),
  motivo: z.string().min(10).max(1000),
});

type FormValues = z.infer<typeof solicitarInputSchema>;

/**
 * ECE — Formulario de nueva solicitud de rectificación.
 * Recibe documentoInstanciaId por query param.
 */
export default function NuevaRectificacionPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const docId = searchParams.get("documentoInstanciaId") ?? "";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(solicitarInputSchema),
    defaultValues: { documentoInstanciaId: docId },
  });

  const solicitar = trpc.eceRectificacion.solicitar.useMutation({
    onSuccess: () => {
      router.push(
        `/ece/rectificaciones?documentoInstanciaId=${docId}`,
      );
    },
  });

  const onSubmit = (values: FormValues) => {
    solicitar.mutate(values);
  };

  if (!docId) {
    return (
      <p className="text-sm text-destructive">
        Falta el parámetro documentoInstanciaId. Accede desde un documento firmado.
      </p>
    );
  }

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
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <input
              type="hidden"
              {...register("documentoInstanciaId")}
              value={docId}
            />

            <div className="space-y-1.5">
              <Label htmlFor="campo">Campo a rectificar</Label>
              <Input
                id="campo"
                placeholder="Ej: diagnostico_principal"
                aria-invalid={!!errors.campo}
                aria-describedby={errors.campo ? "campo-error" : undefined}
                {...register("campo")}
              />
              {errors.campo && (
                <p id="campo-error" className="text-xs text-destructive">
                  {errors.campo.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="valorAnterior">Valor anterior (original)</Label>
              <Textarea
                id="valorAnterior"
                rows={3}
                aria-invalid={!!errors.valorAnterior}
                aria-describedby={
                  errors.valorAnterior ? "valorAnterior-error" : undefined
                }
                {...register("valorAnterior")}
              />
              {errors.valorAnterior && (
                <p id="valorAnterior-error" className="text-xs text-destructive">
                  {errors.valorAnterior.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="valorPropuesto">Valor propuesto (corrección)</Label>
              <Textarea
                id="valorPropuesto"
                rows={3}
                aria-invalid={!!errors.valorPropuesto}
                aria-describedby={
                  errors.valorPropuesto ? "valorPropuesto-error" : undefined
                }
                {...register("valorPropuesto")}
              />
              {errors.valorPropuesto && (
                <p id="valorPropuesto-error" className="text-xs text-destructive">
                  {errors.valorPropuesto.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="motivo">Motivo de la rectificación</Label>
              <Textarea
                id="motivo"
                rows={3}
                placeholder="Mínimo 10 caracteres."
                aria-invalid={!!errors.motivo}
                aria-describedby={errors.motivo ? "motivo-error" : undefined}
                {...register("motivo")}
              />
              {errors.motivo && (
                <p id="motivo-error" className="text-xs text-destructive">
                  {errors.motivo.message}
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
                  router.push(
                    `/ece/rectificaciones?documentoInstanciaId=${docId}`,
                  )
                }
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting || solicitar.isPending}>
                Enviar solicitud
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
