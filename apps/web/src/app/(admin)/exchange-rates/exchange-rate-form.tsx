"use client";

/**
 * US-1.3 — Form de creación de tasa de cambio.
 *
 * Validación cliente con `exchangeRateCreateInput` de
 * `@his/contracts/schemas/exchange-rate`. El servidor re-valida con la copia
 * inline en el router (single-source en contracts; ver routers/exchange-rate
 * para la justificación del mirror).
 *
 * UX:
 *  - Selectors `from` / `to` filtran solo monedas activas (currency.list ya
 *    devuelve active=true por defecto).
 *  - Bloquea misma moneda en `to` que en `from` (Zod superRefine).
 *  - Input numérico con step=0.00000001 para soportar Decimal(18,8).
 *  - `validFrom` datetime-local (timezone del navegador → ISO en submit).
 *  - `source` opcional, default "manual" si vacío.
 *
 * No usa react-hook-form (mismo motivo que country-form: librería pendiente).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormError, FormField, FormHint } from "@his/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { exchangeRateCreateInput } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";

type FxRateType = "BUY" | "SELL" | "AVERAGE" | "OFFICIAL" | "FISCAL";

const RATE_TYPES: Array<{ value: FxRateType; label: string; hint: string }> = [
  { value: "OFFICIAL", label: "Oficial", hint: "Publicada por el banco central." },
  { value: "AVERAGE", label: "Promedio", hint: "Promedio compra/venta del mercado." },
  { value: "BUY", label: "Compra", hint: "Bid — el banco compra divisa." },
  { value: "SELL", label: "Venta", hint: "Ask — el banco vende divisa." },
  { value: "FISCAL", label: "Fiscal", hint: "Tasa para reportes tributarios." },
];

interface FormState {
  fromCurrencyId: string;
  toCurrencyId: string;
  rateType: FxRateType;
  rate: string;
  validFrom: string;
  source: string;
}

const INITIAL_STATE: FormState = {
  fromCurrencyId: "",
  toCurrencyId: "",
  rateType: "OFFICIAL",
  rate: "",
  validFrom: new Date().toISOString().slice(0, 16),
  source: "",
};

interface ExchangeRateFormProps {
  onSuccess?: () => void;
}

export function ExchangeRateForm({ onSuccess }: ExchangeRateFormProps) {
  const utils = trpc.useUtils();
  const currencies = trpc.currency.list.useQuery();

  const [values, setValues] = React.useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ title: string; description?: string } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const createMutation = trpcAny.exchangeRate.create.useMutation({
    onSuccess: () => {
      // Invalida tanto la lista del router exchangeRate como las tasas
      // expuestas por currency (ledgers, country page).
      utils.currency.exchangeRates.invalidate();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any).exchangeRate?.list?.invalidate?.();
      setToast({ title: "Tasa creada", description: "Registro inmutable agregado al histórico." });
      setValues(INITIAL_STATE);
      onSuccess?.();
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const setField = <K extends keyof FormState>(key: K, v: FormState[K]) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setErrors({});

    const candidate = {
      fromCurrencyId: values.fromCurrencyId,
      toCurrencyId: values.toCurrencyId,
      rateType: values.rateType,
      rate: values.rate,
      validFrom: values.validFrom ? new Date(values.validFrom) : new Date(NaN),
      ...(values.source.trim() ? { source: values.source.trim() } : {}),
    };

    const parsed = exchangeRateCreateInput.safeParse(candidate);
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
  };

  const isSubmitting = createMutation.isPending;
  const activeCurrencies = currencies.data ?? [];

  return (
    <>
      <Form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField>
            <Label htmlFor="fromCurrencyId">
              Moneda origen <span className="text-destructive">*</span>
            </Label>
            <Select
              value={values.fromCurrencyId || undefined}
              onValueChange={(v) => setField("fromCurrencyId", v)}
            >
              <SelectTrigger id="fromCurrencyId" aria-invalid={Boolean(errors.fromCurrencyId)}>
                <SelectValue placeholder="Selecciona moneda…" />
              </SelectTrigger>
              <SelectContent>
                {activeCurrencies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.isoCode} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormHint>ISO 4217 (solo monedas activas).</FormHint>
            <FormError>{errors.fromCurrencyId}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="toCurrencyId">
              Moneda destino <span className="text-destructive">*</span>
            </Label>
            <Select
              value={values.toCurrencyId || undefined}
              onValueChange={(v) => setField("toCurrencyId", v)}
            >
              <SelectTrigger id="toCurrencyId" aria-invalid={Boolean(errors.toCurrencyId)}>
                <SelectValue placeholder="Selecciona moneda…" />
              </SelectTrigger>
              <SelectContent>
                {activeCurrencies
                  .filter((c) => c.id !== values.fromCurrencyId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.isoCode} — {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <FormHint>Debe ser distinta de la moneda origen.</FormHint>
            <FormError>{errors.toCurrencyId}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="rateType">
              Tipo de tasa <span className="text-destructive">*</span>
            </Label>
            <Select value={values.rateType} onValueChange={(v) => setField("rateType", v as FxRateType)}>
              <SelectTrigger id="rateType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label} — {t.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormError>{errors.rateType}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="rate">
              Tasa <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rate"
              type="number"
              step="0.00000001"
              min="0"
              placeholder="8.75000000"
              value={values.rate}
              onChange={(e) => setField("rate", e.target.value)}
              aria-invalid={Boolean(errors.rate)}
            />
            <FormHint>Decimal positivo, hasta 8 lugares (Decimal(18,8)).</FormHint>
            <FormError>{errors.rate}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="validFrom">
              Vigente desde <span className="text-destructive">*</span>
            </Label>
            <Input
              id="validFrom"
              type="datetime-local"
              value={values.validFrom}
              onChange={(e) => setField("validFrom", e.target.value)}
              aria-invalid={Boolean(errors.validFrom)}
            />
            <FormHint>Hora local del navegador. Máximo 30 días en el futuro.</FormHint>
            <FormError>{errors.validFrom}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="source">Fuente</Label>
            <Input
              id="source"
              placeholder="manual, BCR, Bloomberg, …"
              maxLength={80}
              value={values.source}
              onChange={(e) => setField("source", e.target.value)}
            />
            <FormHint>Opcional. Si se omite, queda como &quot;manual&quot;.</FormHint>
            <FormError>{errors.source}</FormError>
          </FormField>
        </div>

        {serverError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {serverError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : "Crear tasa"}
          </Button>
        </div>
      </Form>

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
