"use client";

/**
 * US-1.6 — Diálogo para cambiar la moneda funcional de una organización.
 * Flujo destructivo en dos fases:
 *   1) Submit normal → server responde requiresConfirmation=true si hay encuentros.
 *   2) Submit con confirm=true → persiste y muestra warning post-cambio.
 * Solo el rol ADMIN puede llegar aquí (gating en cliente + en server).
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

type Currency = {
  id: string;
  isoCode: string;
  name: string;
  symbol: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: {
    id: string;
    legalName: string;
    tradeName: string | null;
    functionalCurrency: string;
    functionalCurr: Currency | null;
  } | null;
};

export function OrganizationCurrencyDialog({ open, onOpenChange, organization }: Props) {
  const utils = trpc.useUtils();
  const currencies = trpc.currency.list.useQuery(undefined, { enabled: open });
  const [currencyId, setCurrencyId] = React.useState<string>("");
  const [pendingWarning, setPendingWarning] = React.useState<string | null>(null);
  const [postWarning, setPostWarning] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Reset state al abrir/cerrar o cambiar org.
  React.useEffect(() => {
    if (open && organization) {
      setCurrencyId(organization.functionalCurrency);
      setPendingWarning(null);
      setPostWarning(null);
      setErrorMsg(null);
    }
  }, [open, organization]);

  const mutation = trpc.organization.setFunctionalCurrency.useMutation({
    onSuccess: async (res) => {
      if (res.requiresConfirmation) {
        setPendingWarning(res.warning);
        return;
      }
      setPostWarning(res.warning);
      setPendingWarning(null);
      await utils.organization.listAll.invalidate();
      // Cerramos tras un breve momento para que el usuario lea el resultado
      // (si no hay warning post-cambio, cerramos inmediatamente).
      if (!res.warning) onOpenChange(false);
    },
    onError: (err) => {
      setErrorMsg(err.message);
    },
  });

  if (!organization) return null;

  const isSame = currencyId === organization.functionalCurrency;
  const isPending = mutation.isPending;

  function handleSubmit(confirm: boolean) {
    if (!organization || !currencyId) return;
    setErrorMsg(null);
    mutation.mutate({
      organizationId: organization.id,
      currencyId,
      confirmDestructive: confirm,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar moneda funcional</DialogTitle>
          <DialogDescription>
            {organization.tradeName ?? organization.legalName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="currency-select">Moneda funcional</Label>
            <Select value={currencyId} onValueChange={setCurrencyId} disabled={isPending}>
              <SelectTrigger id="currency-select">
                <SelectValue placeholder="Selecciona una moneda" />
              </SelectTrigger>
              <SelectContent>
                {currencies.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="font-mono">{c.isoCode}</span> — {c.name} ({c.symbol})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Actual: <span className="font-mono">{organization.functionalCurr?.isoCode ?? "—"}</span>
            </p>
          </div>

          {pendingWarning && (
            <Alert variant="destructive">
              <AlertTitle>Confirmación requerida</AlertTitle>
              <AlertDescription>{pendingWarning}</AlertDescription>
            </Alert>
          )}

          {postWarning && (
            <Alert>
              <AlertTitle>Cambio aplicado</AlertTitle>
              <AlertDescription>{postWarning}</AlertDescription>
            </Alert>
          )}

          {errorMsg && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          {pendingWarning ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => handleSubmit(true)}
              disabled={isPending}
            >
              {isPending ? "Aplicando…" : "Confirmar cambio"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={isPending || isSame || !currencyId}
            >
              {isPending ? "Validando…" : "Guardar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
