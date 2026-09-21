"use client";

/**
 * R4.5 — diálogo para el switch de MFA staff por organización
 * (`Organization.mfaStaffRequired`, SQL 263). Solo editable por ADMIN; el
 * server re-valida el rol. Default false — encenderlo en prod es decisión
 * runtime de Edwin.
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
import { Label } from "@his/ui/components/label";
import { Switch } from "@his/ui/components/switch";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

type OrgMfaData = {
  id: string;
  legalName: string;
  tradeName: string | null;
  mfaStaffRequired: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: OrgMfaData | null;
};

export function OrganizationMfaDialog({ open, onOpenChange, organization }: Props) {
  const utils = trpc.useUtils();
  const [required, setRequired] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && organization) {
      setRequired(organization.mfaStaffRequired);
      setErrorMsg(null);
    }
  }, [open, organization]);

  const mutation = trpc.organization.setMfaStaffRequired.useMutation({
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
  const isUnchanged = required === organization.mfaStaffRequired;

  function handleSubmit() {
    if (!organization) return;
    setErrorMsg(null);
    mutation.mutate({ organizationId: organization.id, mfaStaffRequired: required });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>MFA para el personal</DialogTitle>
          <DialogDescription>{displayName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="mfa-staff-required-switch" className="flex-1">
              Exigir segundo factor (TOTP) a todo el personal de esta organización
            </Label>
            <Switch
              id="mfa-staff-required-switch"
              checked={required}
              onCheckedChange={setRequired}
              disabled={isPending}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Apagado por defecto. Al prenderlo, cualquier usuario sin sesión MFA vigente
            será redirigido a <span className="font-mono">/mfa</span> la próxima vez que
            entre a una página del personal o llame a la API. Verifica en un navegador de
            prueba antes de dejarlo encendido en horario clínico.
          </p>

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
          <Button type="button" onClick={handleSubmit} disabled={isPending || isUnchanged}>
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
