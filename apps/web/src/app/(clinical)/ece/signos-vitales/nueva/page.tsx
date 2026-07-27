"use client";

/**
 * ECE — Nuevo Registro de Signos Vitales (standalone, módulo transversal CC-0012).
 *
 * Ruta: /ece/signos-vitales/nueva?episodioId=<uuid> | ?cuentaId=<uuid>
 * (acepta ambos o uno solo — el router resuelve el ancla faltante server-side,
 * mismo algoritmo que `historia-clinica/nueva`).
 *
 * Reemplaza el form bespoke anterior (rangos/alertas propios, sin cuentaId,
 * sin fórmula obstétrica) por el módulo compartido `@/components/signos-vitales`
 * — misma fuente de rangos/alertas/cálculos que HC y evolución (mockup avante7).
 *
 * Flujo de alta frecuencia: crea en "borrador" y firma inmediatamente
 * (borrador → firmado en una sola acción), igual que el form anterior.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";
import { calcularEdad } from "@his/contracts/validators";
import { SignosVitalesCapture } from "@/components/signos-vitales/SignosVitalesCapture";
import { useSignosVitales } from "@/components/signos-vitales/useSignosVitales";

export default function NuevoSignoVitalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const episodioIdParam = searchParams.get("episodioId") || undefined;
  const cuentaIdParam = searchParams.get("cuentaId") || undefined;

  // Si vino cuentaId, resolvemos paciente (sexo/edad para gineco-obstétrico)
  // y el episodio abierto — mismo contexto que usa historia-clinica/nueva.
  const contextoCuentaQ = trpc.patient.contextoCuenta.useQuery(
    { cuentaId: cuentaIdParam ?? "" },
    { enabled: !!cuentaIdParam && /^[0-9a-f-]{36}$/i.test(cuentaIdParam) },
  );
  const ctx = contextoCuentaQ.data;
  const paciente = ctx?.paciente ?? null;
  const pacienteSexo = paciente?.biologicalSexId ?? null;
  const pacienteEdad = calcularEdad(paciente?.birthDate ?? null);
  const episodioIdEfectivo = episodioIdParam ?? ctx?.episodioId ?? undefined;

  const anclaFaltante = !episodioIdEfectivo && !cuentaIdParam;

  const firmarM = trpc.eceSignosVitales.firmar.useMutation();
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const vitalesHook = useSignosVitales({ sexo: pacienteSexo, edad: pacienteEdad });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (anclaFaltante) {
      setSubmitError("Se requiere episodioId o cuentaId en la URL.");
      return;
    }

    setSubmitting(true);
    try {
      const resultado = await vitalesHook.guardar({
        episodioId: episodioIdEfectivo,
        cuentaId: cuentaIdParam,
      });
      if (!resultado) return; // validación bloqueó el guardado (showErrors ya activo)

      // Firmar inmediatamente (flujo de alta frecuencia: borrador → firmado en una acción)
      await firmarM.mutateAsync({ id: resultado.id });

      router.push("/ece/signos-vitales");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al registrar signos vitales.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Nuevo registro de signos vitales</h1>
        <p className="text-sm text-muted-foreground">ECE · Captura rápida</p>
      </div>

      {anclaFaltante && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          Se requiere <code>?episodioId=</code> o <code>?cuentaId=</code> en la URL.
        </div>
      )}

      {submitError && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-label="Formulario de signos vitales">
        <SignosVitalesCapture
          idPrefix="sv-standalone"
          value={vitalesHook.value}
          onChange={vitalesHook.setValue}
          sexo={pacienteSexo}
          edad={pacienteEdad}
          showErrors={vitalesHook.showErrors}
        />

        {vitalesHook.showErrors && vitalesHook.bloqueado && vitalesHook.mensajeError && (
          <p role="alert" className="text-sm text-destructive">
            {vitalesHook.mensajeError}
          </p>
        )}

        {/* Acciones */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={submitting || anclaFaltante}
            aria-busy={submitting}
          >
            {submitting ? "Registrando..." : "Registrar y Firmar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
