"use client";

/**
 * US-1.4 — Dialog crear/editar libro contable.
 *
 * Modos:
 *   - create: muestra select kind (filtra los ya activos para evitar CONFLICT
 *     temprano en el cliente; el server re-valida).
 *   - edit  : kind queda readonly (cambiar kind rompe la cadena contable).
 *
 * Validaciones cliente:
 *   - name >= 3 chars
 *   - kind requerido (create)
 *   - currency requerida
 *
 * Si el server responde "existe inactivo", mostramos un hint con botón
 * "Reactivar" (la lista lo expone). El form sólo lanza el toast destructivo
 * con el mensaje del server.
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
import { trpc } from "@/lib/trpc/react";

type LedgerKind =
  | "FISCAL_LOCAL"
  | "IFRS"
  | "US_GAAP"
  | "MANAGEMENT"
  | "BUDGET"
  | "STATISTICAL";

type Ledger = {
  id: string;
  organizationId: string;
  kind: LedgerKind;
  name: string;
  currencyId: string;
  active: boolean;
};

interface LedgerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** undefined = create; objeto = edit. */
  initialValue?: Ledger;
  onSuccess?: () => void;
}

export function LedgerForm({
  open,
  onOpenChange,
  organizationId,
  initialValue,
  onSuccess,
}: LedgerFormProps) {
  const isEdit = Boolean(initialValue?.id);
  const utils = trpc.useUtils();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;

  const [kind, setKind] = React.useState<LedgerKind | "">(
    (initialValue?.kind as LedgerKind | undefined) ?? "",
  );
  const [name, setName] = React.useState(initialValue?.name ?? "");
  const [currencyId, setCurrencyId] = React.useState(initialValue?.currencyId ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  React.useEffect(() => {
    if (open) {
      setKind((initialValue?.kind as LedgerKind | undefined) ?? "");
      setName(initialValue?.name ?? "");
      setCurrencyId(initialValue?.currencyId ?? "");
      setErrors({});
      setServerError(null);
    }
  }, [open, initialValue]);

  const currencies = trpc.currency.list.useQuery();
  const kindsQuery = trpcAny.ledger.listKinds.useQuery(
    { organizationId },
    { enabled: open },
  );

  const createMutation = trpcAny.ledger.create.useMutation({
    onSuccess: () => {
      trpcAny.ledger.list.invalidate?.();
      utils.invalidate(); // fallback: refresca todo el árbol tRPC
      setToast({ title: "Libro creado", variant: "success" });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const updateMutation = trpcAny.ledger.update.useMutation({
    onSuccess: () => {
      utils.invalidate();
      setToast({ title: "Libro actualizado", variant: "success" });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  type KindOption = {
    kind: LedgerKind;
    label: string;
    description: string;
    alreadyActive: boolean;
    existsInactive: boolean;
  };
  const kindOptions: KindOption[] = (kindsQuery.data ?? []) as KindOption[];

  const validate = () => {
    const fe: Record<string, string> = {};
    if (!isEdit && !kind) fe.kind = "Selecciona un tipo de libro.";
    if (!name || name.trim().length < 3) fe.name = "Nombre mínimo 3 caracteres.";
    if (!currencyId) fe.currencyId = "Selecciona una moneda funcional.";
    setErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    if (isEdit && initialValue) {
      updateMutation.mutate({
        id: initialValue.id,
        name: name.trim(),
        functionalCurrencyId: currencyId,
      });
    } else {
      createMutation.mutate({
        organizationId,
        kind,
        name: name.trim(),
        functionalCurrencyId: currencyId,
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar libro contable" : "Nuevo libro contable"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Sólo puedes editar nombre y moneda funcional. El tipo de libro es inmutable."
                : "Activa un libro contable para esta organización. Sólo puede existir un libro activo por tipo."}
            </DialogDescription>
          </DialogHeader>

          <Form onSubmit={handleSubmit}>
            <FormField>
              <Label htmlFor="kind">
                Tipo de libro<span className="text-destructive"> *</span>
              </Label>
              {isEdit ? (
                <Input id="kind" value={initialValue?.kind ?? ""} disabled readOnly />
              ) : (
                <Select value={kind || ""} onValueChange={(v) => setKind(v as LedgerKind)}>
                  <SelectTrigger aria-invalid={Boolean(errors.kind)}>
                    <SelectValue placeholder="Selecciona…" />
                  </SelectTrigger>
                  <SelectContent>
                    {kindOptions.map((k) => (
                      <SelectItem
                        key={k.kind}
                        value={k.kind}
                        disabled={k.alreadyActive}
                      >
                        {k.label}
                        {k.alreadyActive ? " · ya activo" : ""}
                        {k.existsInactive ? " · inactivo (reactivar desde la tabla)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <FormHint>
                {kind
                  ? kindOptions.find((k) => k.kind === kind)?.description
                  : "Selecciona el tipo contable a activar."}
              </FormHint>
              <FormError>{errors.kind}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="name">
                Nombre<span className="text-destructive"> *</span>
              </Label>
              <Input
                id="name"
                placeholder="Ej. Libro Fiscal Hospital Avante 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(errors.name)}
              />
              <FormError>{errors.name}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="currency">
                Moneda funcional<span className="text-destructive"> *</span>
              </Label>
              <Select value={currencyId || ""} onValueChange={(v) => setCurrencyId(v)}>
                <SelectTrigger aria-invalid={Boolean(errors.currencyId)}>
                  <SelectValue placeholder="Selecciona moneda…" />
                </SelectTrigger>
                <SelectContent>
                  {(currencies.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.isoCode} — {c.name} ({c.symbol})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormHint>Moneda en la que se llevan los saldos de este libro.</FormHint>
              <FormError>{errors.currencyId}</FormError>
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
                {isSubmitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear libro"}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>

      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
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
