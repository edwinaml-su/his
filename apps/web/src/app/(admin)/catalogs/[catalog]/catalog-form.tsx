"use client";

/**
 * US-3.2 — Form genérico para crear / editar registros de catálogos.
 *
 * Renderiza inputs según `config.fields`, valida cliente con el schema Zod
 * publicado en @his/contracts y dispara `trpc.catalog.create|update`.
 *
 * NOTA: el stack target indica react-hook-form, pero el repo aún no lo tiene
 * instalado y la tarea prohíbe `npm install`. Se usa estado controlado +
 * Zod parsing al submit (mismo patrón que `<Form>` en @his/ui). Migración a
 * react-hook-form queda como TODO(Sprint 2).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormError, FormField, FormHint } from "@his/ui/components/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { catalogDataSchemas, type CatalogKey } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import { CatalogConfig, CatalogField } from "./catalog-config";

type Row = Record<string, unknown>;

interface CatalogFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: CatalogConfig;
  /** undefined = create; objeto = edit. */
  initialValue?: Row;
  onSuccess?: () => void;
}

function buildDefaults(fields: CatalogField[], initial?: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (initial && initial[f.name] !== undefined && initial[f.name] !== null) {
      out[f.name] = initial[f.name];
    } else if (f.type === "boolean") {
      out[f.name] = true; // active default
    } else if (f.type === "number") {
      out[f.name] = "";
    } else {
      out[f.name] = "";
    }
  }
  return out;
}

/** Convierte strings vacíos en undefined / null según el tipo (Zod-friendly). */
function normalize(values: Record<string, unknown>, fields: CatalogField[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (v === "" || v === undefined) {
      if (!f.required) out[f.name] = null;
      // requeridos vacíos: dejar fuera para que Zod marque error
    } else {
      out[f.name] = v;
    }
  }
  return out;
}

export function CatalogForm({
  open,
  onOpenChange,
  config,
  initialValue,
  onSuccess,
}: CatalogFormProps) {
  const isEdit = Boolean(initialValue?.id);
  const utils = trpc.useUtils();

  const [values, setValues] = React.useState<Record<string, unknown>>(() =>
    buildDefaults(config.fields, initialValue),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ title: string; description?: string } | null>(null);

  // Reset al cambiar de registro/abrir.
  React.useEffect(() => {
    if (open) {
      setValues(buildDefaults(config.fields, initialValue));
      setErrors({});
      setServerError(null);
    }
  }, [open, initialValue, config.fields]);

  const createMutation = trpc.catalog.create.useMutation({
    onSuccess: () => {
      utils.catalog.list.invalidate();
      setToast({ title: "Registro creado", description: `${config.singular} agregado.` });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });

  const updateMutation = trpc.catalog.update.useMutation({
    onSuccess: () => {
      utils.catalog.list.invalidate();
      setToast({ title: "Registro actualizado", description: `${config.singular} guardado.` });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setErrors({});

    const normalized = normalize(values, config.fields);
    const schema = catalogDataSchemas[config.model as CatalogKey];
    const parsed = schema.safeParse(normalized);

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.errors) {
        const path = issue.path[0];
        if (typeof path === "string" && !fieldErrors[path]) {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    const data = parsed.data as Record<string, unknown>;

    if (isEdit) {
      updateMutation.mutate({
        catalog: config.model,
        id: initialValue!.id as string,
        data,
      });
    } else {
      createMutation.mutate({ catalog: config.model, data });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? `Editar ${config.singular}` : `Nuevo ${config.singular}`}
            </DialogTitle>
            <DialogDescription>{config.description}</DialogDescription>
          </DialogHeader>

          <Form onSubmit={handleSubmit}>
            {config.fields.map((field) => (
              <FormField key={field.name}>
                <Label htmlFor={field.name}>
                  {field.label}
                  {field.required ? <span className="text-destructive"> *</span> : null}
                </Label>

                {field.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      id={field.name}
                      type="checkbox"
                      checked={Boolean(values[field.name])}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [field.name]: e.target.checked }))
                      }
                      className="h-4 w-4 rounded border-input"
                    />
                    <span className="text-muted-foreground">
                      {values[field.name] ? "Activo" : "Inactivo (soft delete)"}
                    </span>
                  </label>
                ) : (
                  <Input
                    id={field.name}
                    type={field.type === "number" ? "number" : "text"}
                    placeholder={field.placeholder}
                    value={(values[field.name] as string | number | undefined) ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setValues((v) => ({
                        ...v,
                        [field.name]: field.type === "number" && raw !== "" ? Number(raw) : raw,
                      }));
                    }}
                    aria-invalid={Boolean(errors[field.name])}
                  />
                )}

                {field.hint ? <FormHint>{field.hint}</FormHint> : null}
                <FormError>{errors[field.name]}</FormError>
              </FormField>
            ))}

            {serverError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {serverError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear"}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>

      {toast ? (
        <Toast
          variant="success"
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </>
  );
}
