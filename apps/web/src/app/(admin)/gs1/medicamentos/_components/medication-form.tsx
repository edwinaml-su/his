"use client";

/**
 * MedicationForm — dialog de edición de GTIN medicamento (US.F2.6.4).
 *
 * Usa el patrón del proyecto: estado controlado + Zod safeParse en submit.
 * Sin react-hook-form (no disponible en el stack MVP).
 *
 * Permite editar: descripción, fabricante, presentación, ATC, principio activo,
 * principios activos (array), excipientes alergénicos (array), vencimiento lote.
 */

import * as React from "react";
import { z } from "zod";
import { X, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Form, FormField, FormError, FormHint } from "@his/ui/components/form";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Schema de validación
// ---------------------------------------------------------------------------

const formSchema = z.object({
  descripcion:          z.string().min(1, "Requerido").max(500),
  fabricante:           z.string().min(1, "Requerido").max(300),
  presentacion:         z.string().min(1, "Requerido").max(200),
  principioActivo:      z.string().max(300).optional(),
  codigoAtc:            z
    .string()
    .regex(/^[A-Z]\d{2}[A-Z]{2}\d{2}$/, "Formato ATC inválido (ej. A02BC01)")
    .optional()
    .or(z.literal("")),
  loteVencimiento:      z.string().optional(),
});

type FormState = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// Tipos de prop
// ---------------------------------------------------------------------------

interface MedicationData {
  id: string;
  descripcion: string;
  fabricante: string;
  presentacion: string;
  principioActivo?: string | null;
  codigoAtc?: string | null;
  principiosActivos: string[];
  excipientesAlergenos: string[];
  loteVencimiento?: Date | null;
}

interface MedicationFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medication: MedicationData;
  onSuccess?: () => void;
}

// ---------------------------------------------------------------------------
// Editor de array de strings (principios activos / excipientes)
// ---------------------------------------------------------------------------

function StringArrayEditor({
  label,
  items,
  onAdd,
  onRemove,
  onChange,
  testIdPrefix,
}: {
  label: string;
  items: string[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onChange: (i: number, v: string) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            value={item}
            onChange={(e) => onChange(idx, e.target.value)}
            placeholder={`${label} ${idx + 1}`}
            className="flex-1"
            data-testid={`${testIdPrefix}-${idx}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(idx)}
            aria-label={`Eliminar ${label} ${idx + 1}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdd}
        data-testid={`btn-add-${testIdPrefix}`}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Agregar
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function MedicationForm({
  open,
  onOpenChange,
  medication,
  onSuccess,
}: MedicationFormProps) {
  const [values, setValues] = React.useState<FormState>({
    descripcion:     medication.descripcion,
    fabricante:      medication.fabricante,
    presentacion:    medication.presentacion,
    principioActivo: medication.principioActivo ?? "",
    codigoAtc:       medication.codigoAtc ?? "",
    loteVencimiento: medication.loteVencimiento
      ? new Date(medication.loteVencimiento).toISOString().split("T")[0]
      : "",
  });
  const [principiosActivos,    setPrincipios]    = React.useState<string[]>(medication.principiosActivos);
  const [excipientesAlergenos, setExcipientes]   = React.useState<string[]>(medication.excipientesAlergenos);
  const [errors,       setErrors]       = React.useState<Record<string, string>>({});
  const [serverError,  setServerError]  = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setValues({
        descripcion:     medication.descripcion,
        fabricante:      medication.fabricante,
        presentacion:    medication.presentacion,
        principioActivo: medication.principioActivo ?? "",
        codigoAtc:       medication.codigoAtc ?? "",
        loteVencimiento: medication.loteVencimiento
          ? new Date(medication.loteVencimiento).toISOString().split("T")[0]
          : "",
      });
      setPrincipios(medication.principiosActivos);
      setExcipientes(medication.excipientesAlergenos);
      setErrors({});
      setServerError(null);
    }
  }, [open, medication]);

  const utils = trpc.useUtils();
  const updateMutation = trpc.gs1Medication.update.useMutation({
    onSuccess: () => {
      void utils.gs1Medication.list.invalidate();
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err) => setServerError(err.message),
  });

  const setField = <K extends keyof FormState>(key: K, v: FormState[K]) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setServerError(null);

    const parsed = formSchema.safeParse(values);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const issue of parsed.error.errors) {
        const k = String(issue.path[0] ?? "");
        if (k && !fe[k]) fe[k] = issue.message;
      }
      setErrors(fe);
      return;
    }

    updateMutation.mutate({
      id: medication.id,
      descripcion:          parsed.data.descripcion,
      fabricante:           parsed.data.fabricante,
      presentacion:         parsed.data.presentacion,
      principioActivo:      parsed.data.principioActivo || undefined,
      codigoAtc:            parsed.data.codigoAtc || undefined,
      principiosActivos:    principiosActivos.filter(Boolean),
      excipientesAlergenos: excipientesAlergenos.filter(Boolean),
      loteVencimiento:      parsed.data.loteVencimiento
        ? new Date(parsed.data.loteVencimiento).toISOString()
        : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        aria-describedby="med-form-desc"
      >
        <DialogHeader>
          <DialogTitle>Editar medicamento GTIN</DialogTitle>
          <p id="med-form-desc" className="text-sm text-muted-foreground">
            Actualiza datos clínicos, principios activos y excipientes alergénicos.
          </p>
        </DialogHeader>

        <Form onSubmit={handleSubmit}>
          {serverError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {serverError}
            </p>
          )}

          <FormField>
            <Label htmlFor="med-descripcion">
              Descripción <span className="text-destructive">*</span>
            </Label>
            <Input
              id="med-descripcion"
              value={values.descripcion}
              onChange={(e) => setField("descripcion", e.target.value)}
              aria-invalid={Boolean(errors.descripcion)}
              data-testid="input-med-descripcion"
            />
            <FormError>{errors.descripcion}</FormError>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label htmlFor="med-fabricante">Fabricante <span className="text-destructive">*</span></Label>
              <Input
                id="med-fabricante"
                value={values.fabricante}
                onChange={(e) => setField("fabricante", e.target.value)}
                aria-invalid={Boolean(errors.fabricante)}
              />
              <FormError>{errors.fabricante}</FormError>
            </FormField>
            <FormField>
              <Label htmlFor="med-presentacion">Presentación <span className="text-destructive">*</span></Label>
              <Input
                id="med-presentacion"
                value={values.presentacion}
                onChange={(e) => setField("presentacion", e.target.value)}
                aria-invalid={Boolean(errors.presentacion)}
              />
              <FormError>{errors.presentacion}</FormError>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label htmlFor="med-principio">Principio activo (DCI)</Label>
              <Input
                id="med-principio"
                value={values.principioActivo ?? ""}
                onChange={(e) => setField("principioActivo", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="med-atc">Código ATC</Label>
              <Input
                id="med-atc"
                value={values.codigoAtc ?? ""}
                onChange={(e) => setField("codigoAtc", e.target.value.toUpperCase())}
                placeholder="A02BC01"
                maxLength={7}
                aria-invalid={Boolean(errors.codigoAtc)}
              />
              <FormError>{errors.codigoAtc}</FormError>
            </FormField>
          </div>

          <FormField>
            <Label htmlFor="med-vencimiento">Fecha vencimiento lote</Label>
            <Input
              id="med-vencimiento"
              type="date"
              value={values.loteVencimiento ?? ""}
              onChange={(e) => setField("loteVencimiento", e.target.value)}
              data-testid="input-lote-vencimiento"
            />
            <FormHint>Fecha de vencimiento del lote activo en inventario.</FormHint>
          </FormField>

          <StringArrayEditor
            label="Principios activos"
            items={principiosActivos}
            onAdd={() => setPrincipios((p) => [...p, ""])}
            onRemove={(i) => setPrincipios((p) => p.filter((_, idx) => idx !== i))}
            onChange={(i, v) => setPrincipios((p) => p.map((x, idx) => (idx === i ? v : x)))}
            testIdPrefix="principio"
          />

          <StringArrayEditor
            label="Excipientes alergénicos"
            items={excipientesAlergenos}
            onAdd={() => setExcipientes((p) => [...p, ""])}
            onRemove={(i) => setExcipientes((p) => p.filter((_, idx) => idx !== i))}
            onChange={(i, v) => setExcipientes((p) => p.map((x, idx) => (idx === i ? v : x)))}
            testIdPrefix="excipiente"
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              data-testid="btn-med-guardar"
            >
              {updateMutation.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
