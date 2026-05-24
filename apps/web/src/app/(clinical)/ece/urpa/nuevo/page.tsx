"use client";

/**
 * ECE — Nuevo Ingreso URPA.
 *
 * Registra el ingreso del paciente a la Unidad de Recuperación Post-Anestésica
 * (URPA). Campos requeridos: actoQuirurgicoId + escalaAldreteIngreso.
 *
 * Rol habilitado: NURSE.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos del formulario
// ---------------------------------------------------------------------------

interface FormState {
  actoQuirurgicoId: string;
  escalaAldreteIngreso: string;
  complicaciones: string;
}

const INITIAL_FORM: FormState = {
  actoQuirurgicoId: "",
  escalaAldreteIngreso: "",
  complicaciones: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIntOrError(v: string, label: string): number | string {
  if (v.trim() === "") return `${label} es requerido.`;
  const n = parseInt(v, 10);
  if (isNaN(n)) return `${label} debe ser un número entero.`;
  return n;
}

function validate(f: FormState): string | null {
  if (!f.actoQuirurgicoId.trim()) {
    return "El UUID del acto quirúrgico es requerido.";
  }
  if (!/^[0-9a-f-]{36}$/i.test(f.actoQuirurgicoId.trim())) {
    return "El UUID del acto quirúrgico no tiene formato válido.";
  }
  const aldrete = toIntOrError(f.escalaAldreteIngreso, "Escala Aldrete de ingreso");
  if (typeof aldrete === "string") return aldrete;
  if (aldrete < 0 || aldrete > 10) {
    return "Escala Aldrete de ingreso debe estar entre 0 y 10.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NuevoUrpaPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const createMutation = trpc.eceUrpa.create.useMutation({
    onSuccess: (data: { id: string }) => {
      router.push(`/ece/urpa/${data.id}`);
    },
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    createMutation.mutate({
      actoQuirurgicoId: form.actoQuirurgicoId.trim(),
      escalaAldreteIngreso: parseInt(form.escalaAldreteIngreso, 10),
      complicaciones: form.complicaciones.trim() || undefined,
    });
  }

  const errorMsg = clientError ?? createMutation.error?.message ?? null;
  const isSubmitting = createMutation.isPending;

  const aldreteNum =
    form.escalaAldreteIngreso.trim() !== ""
      ? parseInt(form.escalaAldreteIngreso, 10)
      : NaN;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Registrar Ingreso URPA</h1>
        <p className="text-sm text-muted-foreground">
          Unidad de Recuperación Post-Anestésica — NTEC Art. 36.
          Registra el ingreso del paciente tras un acto quirúrgico.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Datos del ingreso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Acto quirúrgico */}
            <div className="space-y-1.5">
              <Label htmlFor="acto-id">UUID del acto quirúrgico *</Label>
              <Input
                id="acto-id"
                required
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={form.actoQuirurgicoId}
                onChange={(e) => update("actoQuirurgicoId", e.target.value)}
                className="font-mono text-sm"
                aria-describedby="acto-id-hint"
              />
              <p id="acto-id-hint" className="text-xs text-muted-foreground">
                UUID del acto quirúrgico que origina el ingreso a URPA.
              </p>
            </div>

            {/* Escala Aldrete de ingreso */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="aldrete-ingreso">
                  Escala Aldrete al ingreso (0–10) *
                </Label>
                <span className="text-sm font-medium tabular-nums">
                  {!isNaN(aldreteNum) ? aldreteNum : "—"}
                </span>
              </div>
              <input
                id="aldrete-ingreso"
                type="range"
                min={0}
                max={10}
                value={!isNaN(aldreteNum) ? aldreteNum : 5}
                onChange={(e) => update("escalaAldreteIngreso", e.target.value)}
                className="h-2 w-full cursor-pointer accent-primary"
                aria-valuemin={0}
                aria-valuemax={10}
                aria-valuenow={!isNaN(aldreteNum) ? aldreteNum : 5}
                aria-label="Escala Aldrete al ingreso"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span className="text-center">actividad · respiración · circulación · consciencia · SpO2</span>
                <span>10</span>
              </div>
              <p className="text-xs text-muted-foreground">
                ≥9 = alta estándar · 5–8 = observación prolongada · ≤4 = valorar traslado UCI
              </p>
            </div>

            {/* Complicaciones */}
            <div className="space-y-1.5">
              <Label htmlFor="complicaciones">Complicaciones observadas (opcional)</Label>
              <textarea
                id="complicaciones"
                rows={3}
                value={form.complicaciones}
                onChange={(e) => update("complicaciones", e.target.value)}
                placeholder="Describa las complicaciones observadas al ingreso, si las hay."
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </CardContent>
        </Card>

        {errorMsg && (
          <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
            {errorMsg}
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
            {isSubmitting ? "Registrando…" : "Registrar ingreso"}
          </Button>
        </div>
      </form>
    </div>
  );
}
