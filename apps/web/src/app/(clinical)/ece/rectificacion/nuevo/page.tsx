"use client";

/**
 * ECE — Solicitar rectificacion de documento firmado (NTEC Art. 42).
 *
 * Flujo:
 *   1. Capturar documentoInstanciaId del documento a rectificar.
 *   2. Indicar campo, valor anterior, valor propuesto y motivo (justificacion).
 *   3. Enviar — crea registro PENDIENTE en ece.rectificacion.
 *
 * El documento original NO se modifica. La rectificacion firmada por el
 * autor original (con PIN) cierra el ciclo. Impacto MEDIO+ requiere
 * ademas la aprobacion del director medico.
 *
 * Restricciones NTEC:
 *   - Solo documentos en estado firmado/validado/cerrado.
 *   - No procede para contenido constitutivo de CONS_INF (Art. 40).
 *   - Errores tipograficos sin impacto clinico/legal no justifican RECT.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import { trpc } from "@/lib/trpc/react";

const formSchema = z.object({
  documentoInstanciaId: z.string().uuid({ message: "UUID del documento requerido." }),
  campo: z
    .string()
    .min(1, "Campo requerido.")
    .max(200, "Maximo 200 caracteres."),
  valorAnterior: z
    .string()
    .min(1, "Indique el valor original.")
    .max(2000),
  valorPropuesto: z
    .string()
    .min(1, "Indique el valor corregido.")
    .max(2000),
  motivo: z
    .string()
    .min(10, "La justificacion debe tener al menos 10 caracteres.")
    .max(1000),
});

type FormValues = z.infer<typeof formSchema>;

export default function NuevaRectificacionPage({
  searchParams,
}: {
  searchParams: { documentoInstanciaId?: string; episodioId?: string };
}) {
  const router = useRouter();
  const episodioId = searchParams.episodioId ?? "";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      documentoInstanciaId: searchParams.documentoInstanciaId ?? "",
    },
  });

  const solicitar = trpc.eceRectificacion.solicitar.useMutation({
    onSuccess: () => {
      const back = episodioId
        ? `/ece/rectificacion?episodioId=${episodioId}`
        : `/ece/rectificacion`;
      router.push(back);
    },
  });

  async function onSubmit(values: FormValues) {
    await solicitar.mutateAsync(values);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Solicitar rectificacion</h1>
        <p className="text-sm text-muted-foreground">
          El documento original no se modificara. Se emite un registro corrector
          inmutable (NTEC Art. 42).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la rectificacion</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1">
              <Label htmlFor="documentoInstanciaId">
                ID del documento a rectificar (UUID)
              </Label>
              <Input
                id="documentoInstanciaId"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                {...register("documentoInstanciaId")}
              />
              {errors.documentoInstanciaId && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.documentoInstanciaId.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                El documento debe estar firmado. Los borradores se editan directamente.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="campo">Campo a rectificar</Label>
              <Input
                id="campo"
                placeholder="Ej: causa_basica_cie10, tension_arterial_sistolica"
                {...register("campo")}
              />
              {errors.campo && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.campo.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Nombre del campo en la tabla clinica (no el label visible, sino el
                nombre tecnico).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="valorAnterior">Valor original (erroneo)</Label>
                <Textarea
                  id="valorAnterior"
                  rows={3}
                  placeholder="Valor tal como fue capturado"
                  {...register("valorAnterior")}
                />
                {errors.valorAnterior && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.valorAnterior.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="valorPropuesto">Valor correcto</Label>
                <Textarea
                  id="valorPropuesto"
                  rows={3}
                  placeholder="Valor que debe quedar registrado"
                  {...register("valorPropuesto")}
                />
                {errors.valorPropuesto && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.valorPropuesto.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="motivo">
                Justificacion clinico-administrativa
              </Label>
              <Textarea
                id="motivo"
                rows={4}
                placeholder="Describa: que error se detecto, como se detecto, por que es necesaria la correccion, si afecta reportes oficiales (SNIS, ISSS)."
                {...register("motivo")}
              />
              {errors.motivo && (
                <p role="alert" className="text-xs text-destructive">
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
                onClick={() => router.back()}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Enviando..." : "Solicitar rectificacion"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
        <CardContent className="pt-4">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <strong>Recuerde:</strong> La rectificacion solo procede para errores materiales
            en documentos firmados con impacto clinico, legal o estadistico. Cambios de
            criterio clinico (no errores) se documentan como nota evolutiva nueva. El
            contenido constitutivo de consentimientos informados firmados no admite
            rectificacion (NTEC Art. 40).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
