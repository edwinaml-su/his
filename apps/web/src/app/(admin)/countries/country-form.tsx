"use client";

/**
 * US-1.1 — Form de País (Dialog).
 *
 * Crea o edita un país. Validación cliente con `countryCreateInput` /
 * `countryUpdateInput` de @his/contracts. Envía a `trpc.country.create|update`.
 *
 * NOTA: el repo aún no usa react-hook-form (npm install bloqueado por la tarea),
 * así que se replica el patrón de catalog-form: estado controlado + Zod parsing
 * en submit. TODO(Sprint 2): migrar a RHF cuando esté instalado.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { countryCreateInput, countryUpdateInput } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import type { CountryRow } from "./country-table";

interface CountryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** undefined = create; objeto = edit. */
  initialValue?: CountryRow;
}

interface FormState {
  isoAlpha3: string;
  isoNumeric: string;
  name: string;
  defaultLocale: string;
  defaultTzId: string;
  defaultCurrencyId: string;
}

function buildDefaults(initial?: CountryRow): FormState {
  return {
    isoAlpha3: initial?.isoAlpha3 ?? "",
    isoNumeric: initial?.isoNumeric != null ? String(initial.isoNumeric) : "",
    name: initial?.name ?? "",
    defaultLocale: initial?.defaultLocale ?? "",
    defaultTzId: initial?.defaultTzId ?? "",
    defaultCurrencyId: initial?.currencies?.[0]?.currency?.id ?? "",
  };
}

export function CountryForm({ open, onOpenChange, initialValue }: CountryFormProps) {
  const isEdit = Boolean(initialValue?.id);
  const utils = trpc.useUtils();
  const currencies = trpc.currency.list.useQuery();

  const [values, setValues] = React.useState<FormState>(() => buildDefaults(initialValue));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ title: string; description?: string } | null>(null);

  React.useEffect(() => {
    if (open) {
      setValues(buildDefaults(initialValue));
      setErrors({});
      setServerError(null);
    }
  }, [open, initialValue]);

  const createMutation = trpc.country.create.useMutation({
    onSuccess: () => {
      utils.country.list.invalidate();
      setToast({ title: "País creado", description: `${values.name} agregado al sistema.` });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });

  const updateMutation = trpc.country.update.useMutation({
    onSuccess: () => {
      utils.country.list.invalidate();
      setToast({ title: "País actualizado", description: `${values.name} guardado.` });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const setField = <K extends keyof FormState>(key: K, v: FormState[K]) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setErrors({});

    const numericVal = values.isoNumeric === "" ? NaN : Number(values.isoNumeric);

    if (isEdit && initialValue) {
      const candidate: Record<string, unknown> = { id: initialValue.id };
      if (values.isoAlpha3) candidate.isoAlpha3 = values.isoAlpha3.toUpperCase();
      if (!Number.isNaN(numericVal)) candidate.isoNumeric = numericVal;
      if (values.name) candidate.name = values.name;
      if (values.defaultLocale) candidate.defaultLocale = values.defaultLocale;
      if (values.defaultTzId) candidate.defaultTzId = values.defaultTzId;
      if (values.defaultCurrencyId) candidate.defaultCurrencyId = values.defaultCurrencyId;

      const parsed = countryUpdateInput.safeParse(candidate);
      if (!parsed.success) {
        const fe: Record<string, string> = {};
        for (const issue of parsed.error.errors) {
          const k = issue.path[0];
          if (typeof k === "string" && !fe[k]) fe[k] = issue.message;
        }
        setErrors(fe);
        return;
      }
      updateMutation.mutate(parsed.data);
    } else {
      const candidate = {
        isoAlpha3: values.isoAlpha3.toUpperCase(),
        isoNumeric: numericVal,
        name: values.name,
        defaultLocale: values.defaultLocale,
        defaultTzId: values.defaultTzId,
        ...(values.defaultCurrencyId ? { defaultCurrencyId: values.defaultCurrencyId } : {}),
      };

      const parsed = countryCreateInput.safeParse(candidate);
      if (!parsed.success) {
        const fe: Record<string, string> = {};
        for (const issue of parsed.error.errors) {
          const k = issue.path[0];
          if (typeof k === "string" && !fe[k]) fe[k] = issue.message;
        }
        setErrors(fe);
        return;
      }
      createMutation.mutate(parsed.data);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar país" : "Nuevo país"}</DialogTitle>
            <DialogDescription>
              ISO 3166-1 alpha-3 + timezone IANA + moneda funcional.
            </DialogDescription>
          </DialogHeader>

          <Form onSubmit={handleSubmit}>
            <FormField>
              <Label htmlFor="isoAlpha3">
                ISO alpha-3 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="isoAlpha3"
                placeholder="SLV"
                maxLength={3}
                value={values.isoAlpha3}
                onChange={(e) => setField("isoAlpha3", e.target.value.toUpperCase())}
                aria-invalid={Boolean(errors.isoAlpha3)}
              />
              <FormHint>3 letras mayúsculas (ej. SLV, GTM, HND).</FormHint>
              <FormError>{errors.isoAlpha3}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="isoNumeric">
                ISO numérico <span className="text-destructive">*</span>
              </Label>
              <Input
                id="isoNumeric"
                type="number"
                min={1}
                max={999}
                placeholder="222"
                value={values.isoNumeric}
                onChange={(e) => setField("isoNumeric", e.target.value)}
                aria-invalid={Boolean(errors.isoNumeric)}
              />
              <FormHint>Código numérico ISO 3166-1 (3 dígitos, 1-999).</FormHint>
              <FormError>{errors.isoNumeric}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="name">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="El Salvador"
                value={values.name}
                onChange={(e) => setField("name", e.target.value)}
                aria-invalid={Boolean(errors.name)}
              />
              <FormError>{errors.name}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="defaultLocale">
                Locale por defecto <span className="text-destructive">*</span>
              </Label>
              <Input
                id="defaultLocale"
                placeholder="es-SV"
                value={values.defaultLocale}
                onChange={(e) => setField("defaultLocale", e.target.value)}
                aria-invalid={Boolean(errors.defaultLocale)}
              />
              <FormHint>Formato BCP-47 (ej. es-SV, en-US).</FormHint>
              <FormError>{errors.defaultLocale}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="defaultTzId">
                Timezone IANA <span className="text-destructive">*</span>
              </Label>
              <Input
                id="defaultTzId"
                placeholder="America/El_Salvador"
                value={values.defaultTzId}
                onChange={(e) => setField("defaultTzId", e.target.value)}
                aria-invalid={Boolean(errors.defaultTzId)}
              />
              <FormHint>Ej. America/El_Salvador, America/Guatemala.</FormHint>
              <FormError>{errors.defaultTzId}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="defaultCurrencyId">Moneda funcional</Label>
              <Select
                value={values.defaultCurrencyId || undefined}
                onValueChange={(v) => setField("defaultCurrencyId", v)}
              >
                <SelectTrigger id="defaultCurrencyId" aria-invalid={Boolean(errors.defaultCurrencyId)}>
                  <SelectValue placeholder="Selecciona moneda…" />
                </SelectTrigger>
                <SelectContent>
                  {(currencies.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.isoCode} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormHint>ISO 4217. Se enlaza como moneda funcional/legal del país.</FormHint>
              <FormError>{errors.defaultCurrencyId}</FormError>
            </FormField>

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
                {isSubmitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear país"}
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
