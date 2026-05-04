"use client";

/**
 * US-5.5 — Paso 2: epicrisis (resumen, indicaciones, próxima cita).
 * (equipo Lima · Sprint 3)
 */
import * as React from "react";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Button } from "@his/ui/components/button";

export interface EpicrisisFormState {
  summary: string;
  indicationsHome: string;
  followUpAt: string; // datetime-local
  followUpNotes: string;
}

export interface EpicrisisFormProps {
  value: EpicrisisFormState;
  onChange: (next: EpicrisisFormState) => void;
  onBack: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  error?: string | null;
}

/**
 * Confirmación destructiva: el egreso es irreversible. Mostramos un
 * checkbox de "Entiendo que esta acción no se puede deshacer" antes de
 * habilitar el botón final.
 */
export function EpicrisisForm({
  value,
  onChange,
  onBack,
  onConfirm,
  isSubmitting,
  error,
}: EpicrisisFormProps) {
  const [acknowledge, setAcknowledge] = React.useState(false);

  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        if (acknowledge && !isSubmitting) onConfirm();
      }}
    >
      <FormField>
        <Label htmlFor="summary">Resumen clínico</Label>
        <textarea
          id="summary"
          value={value.summary}
          onChange={(e) => onChange({ ...value, summary: e.target.value })}
          placeholder="Evolución, procedimientos relevantes, hallazgos…"
          className="min-h-[120px] w-full rounded-md border bg-background p-3 text-sm"
          maxLength={4000}
        />
      </FormField>

      <FormField>
        <Label htmlFor="indications">Indicaciones para casa</Label>
        <textarea
          id="indications"
          value={value.indicationsHome}
          onChange={(e) =>
            onChange({ ...value, indicationsHome: e.target.value })
          }
          placeholder="Medicación, cuidados, dieta, signos de alarma…"
          className="min-h-[100px] w-full rounded-md border bg-background p-3 text-sm"
          maxLength={4000}
        />
      </FormField>

      <FormField>
        <Label htmlFor="followUpAt">Próxima cita (opcional)</Label>
        <Input
          id="followUpAt"
          type="datetime-local"
          value={value.followUpAt}
          onChange={(e) => onChange({ ...value, followUpAt: e.target.value })}
        />
        {value.followUpAt ? (
          <Input
            className="mt-2"
            value={value.followUpNotes}
            onChange={(e) =>
              onChange({ ...value, followUpNotes: e.target.value })
            }
            placeholder="Especialidad, instrucciones para la cita"
            maxLength={400}
          />
        ) : null}
      </FormField>

      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="font-semibold text-destructive">
          Confirmación destructiva
        </p>
        <p className="text-muted-foreground">
          El egreso es irreversible. Una vez registrado, el encuentro
          quedará cerrado y la cama liberada no podrá reasignarse desde
          este flujo.
        </p>
        <label className="mt-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={acknowledge}
            onChange={(e) => setAcknowledge(e.target.checked)}
          />
          <span>Entiendo que esta acción no se puede deshacer.</span>
        </label>
      </div>

      <FormError>{error}</FormError>

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Atrás
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={!acknowledge || isSubmitting}
        >
          {isSubmitting ? "Registrando egreso…" : "Confirmar egreso"}
        </Button>
      </div>
    </Form>
  );
}
