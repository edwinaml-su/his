"use client";

/**
 * US.F2.S7.W2 — Diálogo para configurar el prefijo GS1 Company de una organización.
 * Solo editable por ADMIN o ADMIN_CLINICO; el server re-valida el rol.
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
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

const GS1_PREFIX_REGEX = /^\d{7,9}$/;

type OrgGs1Data = {
  id: string;
  legalName: string;
  tradeName: string | null;
  gs1CompanyPrefix: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: OrgGs1Data | null;
};

export function OrganizationGs1PrefixDialog({ open, onOpenChange, organization }: Props) {
  const utils = trpc.useUtils();
  const [prefix, setPrefix] = React.useState<string>("");
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && organization) {
      setPrefix(organization.gs1CompanyPrefix ?? "");
      setValidationError(null);
      setErrorMsg(null);
    }
  }, [open, organization]);

  const mutation = trpc.organization.setGs1CompanyPrefix.useMutation({
    onSuccess: async () => {
      await utils.organization.listAll.invalidate();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => {
      setErrorMsg(err.message);
    },
  });

  if (!organization) return null;

  const displayName = organization.tradeName ?? organization.legalName;
  const isPending = mutation.isPending;

  function validatePrefix(value: string): string | null {
    if (value === "") return null; // vacío = null (org sin prefijo GS1)
    if (!GS1_PREFIX_REGEX.test(value)) {
      return "El prefijo GS1 debe tener entre 7 y 9 dígitos numéricos.";
    }
    return null;
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value.replace(/\D/g, "").slice(0, 9);
    setPrefix(value);
    setValidationError(validatePrefix(value));
  }

  function handleSubmit() {
    if (!organization) return;
    const error = validatePrefix(prefix);
    if (error) {
      setValidationError(error);
      return;
    }
    setErrorMsg(null);
    mutation.mutate({
      organizationId: organization.id,
      gs1CompanyPrefix: prefix === "" ? null : prefix,
    });
  }

  const isUnchanged = prefix === (organization.gs1CompanyPrefix ?? "");
  const hasValidationError = validationError !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Prefijo GS1 Company</DialogTitle>
          <DialogDescription>{displayName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="gs1-prefix-input">Prefijo GS1 Company</Label>
            <Input
              id="gs1-prefix-input"
              type="text"
              inputMode="numeric"
              pattern="\d{7,9}"
              maxLength={9}
              value={prefix}
              onChange={handleChange}
              disabled={isPending}
              placeholder="Ej. 7503000"
              aria-describedby="gs1-prefix-helper gs1-prefix-error"
              aria-invalid={hasValidationError}
            />
            <p id="gs1-prefix-helper" className="text-xs text-muted-foreground">
              Prefijo GS1 Company asignado por GS1 El Salvador (7-9 dígitos). Usado para generar
              GSRN-18 de pulseras paciente. Dejar vacío para usar el prefijo de fallback del
              sistema.
            </p>
            {validationError && (
              <p id="gs1-prefix-error" className="text-xs text-destructive" role="alert">
                {validationError}
              </p>
            )}
          </div>

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
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || isUnchanged || hasValidationError}
          >
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
