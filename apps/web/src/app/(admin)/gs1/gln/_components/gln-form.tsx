"use client";

/**
 * GlnForm — dialog para dar de alta un GLN hijo o raíz.
 *
 * Validación: estado controlado + z.safeParse en submit (sin react-hook-form).
 * Dígito verificador GLN-13 validado en cliente antes de enviar al router.
 */

import * as React from "react";
import { z } from "zod";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Validación GLN-13 módulo-10
// ---------------------------------------------------------------------------

function gs1CheckDigitValid(code: string): boolean {
  const len = code.length;
  let sum = 0;
  for (let i = 0; i < len - 1; i++) {
    const weight = (len - 1 - i) % 2 === 0 ? 3 : 1;
    sum += parseInt(code[i]!, 10) * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === parseInt(code[len - 1]!, 10);
}

const formSchema = z.object({
  codigo: z
    .string()
    .length(13, "El GLN debe tener exactamente 13 dígitos")
    .regex(/^\d{13}$/, "Solo dígitos numéricos")
    .refine(gs1CheckDigitValid, "Dígito verificador GS1 inválido"),
  descripcion: z.string().min(1, "Requerido").max(500),
  tipo: z.enum(["proveedor", "deposito", "farmacia", "servicio", "cama"]),
});

type FormState = {
  codigo: string;
  descripcion: string;
  tipo: string;
};

const TIPO_OPTIONS = [
  { value: "proveedor", label: "Proveedor" },
  { value: "deposito",  label: "Almacén / Depósito" },
  { value: "farmacia",  label: "Farmacia" },
  { value: "servicio",  label: "Servicio / Sala" },
  { value: "cama",      label: "Cama" },
] as const;

const DEFAULT_STATE: FormState = { codigo: "", descripcion: "", tipo: "servicio" };

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

interface GlnFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentGlnId?: string;
  parentDescripcion?: string;
  onSuccess?: () => void;
}

export function GlnForm({
  open,
  onOpenChange,
  parentGlnId,
  parentDescripcion,
  onSuccess,
}: GlnFormProps) {
  const [values, setValues] = React.useState<FormState>(DEFAULT_STATE);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setValues(DEFAULT_STATE);
      setErrors({});
      setServerError(null);
    }
  }, [open]);

  const utils = trpc.useUtils();
  const createMutation = trpc.gs1GlnHierarchy.createChild.useMutation({
    onSuccess: () => {
      void utils.gs1GlnHierarchy.tree.invalidate();
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

    createMutation.mutate({
      codigo:       parsed.data.codigo,
      descripcion:  parsed.data.descripcion,
      tipo:         parsed.data.tipo,
      parentGlnId,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="gln-form-desc">
        <DialogHeader>
          <DialogTitle>Nueva ubicación GLN</DialogTitle>
          {parentDescripcion && (
            <p id="gln-form-desc" className="text-sm text-muted-foreground">
              Hija de: <span className="font-medium">{parentDescripcion}</span>
            </p>
          )}
        </DialogHeader>

        <Form onSubmit={handleSubmit}>
          <FormField>
            <Label htmlFor="gln-codigo">
              Código GLN-13 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="gln-codigo"
              value={values.codigo}
              onChange={(e) => setField("codigo", e.target.value)}
              placeholder="0000000000000"
              maxLength={13}
              inputMode="numeric"
              aria-invalid={Boolean(errors.codigo)}
              data-testid="input-gln-codigo"
            />
            <FormHint>13 dígitos numéricos con dígito verificador GS1.</FormHint>
            <FormError>{errors.codigo}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="gln-descripcion">
              Descripción <span className="text-destructive">*</span>
            </Label>
            <Input
              id="gln-descripcion"
              value={values.descripcion}
              onChange={(e) => setField("descripcion", e.target.value)}
              placeholder="Ej. Farmacia Central — Piso 2"
              aria-invalid={Boolean(errors.descripcion)}
              data-testid="input-gln-descripcion"
            />
            <FormError>{errors.descripcion}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="gln-tipo">
              Tipo de ubicación <span className="text-destructive">*</span>
            </Label>
            <Select
              value={values.tipo}
              onValueChange={(v) => setField("tipo", v)}
            >
              <SelectTrigger id="gln-tipo" data-testid="select-gln-tipo">
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                {TIPO_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormError>{errors.tipo}</FormError>
          </FormField>

          {serverError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {serverError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              data-testid="btn-gln-guardar"
            >
              {createMutation.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
