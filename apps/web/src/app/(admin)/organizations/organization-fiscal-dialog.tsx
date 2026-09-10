"use client";

/**
 * Parametrización admin (2026-09-10) — Diálogo para editar la identidad
 * fiscal de una organización (razón social, nombre comercial, NIT, NRC).
 * Antes SQL 227 la sembraba por SQL directo; ahora es editable desde aquí.
 * Solo el rol ADMIN puede llegar aquí (gating en cliente + en server, mismo
 * patrón que `OrganizationCurrencyDialog`/`OrganizationGs1PrefixDialog`).
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

type OrgFiscalData = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  nrc: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: OrgFiscalData | null;
};

export function OrganizationFiscalDialog({ open, onOpenChange, organization }: Props) {
  const utils = trpc.useUtils();
  const [legalName, setLegalName] = React.useState("");
  const [tradeName, setTradeName] = React.useState("");
  const [taxId, setTaxId] = React.useState("");
  const [nrc, setNrc] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && organization) {
      setLegalName(organization.legalName);
      setTradeName(organization.tradeName ?? "");
      setTaxId(organization.taxId);
      setNrc(organization.nrc ?? "");
      setErrorMsg(null);
    }
  }, [open, organization]);

  const mutation = trpc.organization.updateFiscalIdentity.useMutation({
    onSuccess: async () => {
      await utils.organization.listAll.invalidate();
      onOpenChange(false);
    },
    onError: (err) => {
      setErrorMsg(err.message);
    },
  });

  if (!organization) return null;

  const displayName = organization.tradeName ?? organization.legalName;
  const isPending = mutation.isPending;
  const legalNameValid = legalName.trim().length >= 2;
  const taxIdValid = taxId.trim().length >= 1;
  const isUnchanged =
    legalName.trim() === organization.legalName &&
    tradeName.trim() === (organization.tradeName ?? "") &&
    taxId.trim() === organization.taxId &&
    nrc.trim() === (organization.nrc ?? "");

  function handleSubmit() {
    if (!organization || !legalNameValid || !taxIdValid) return;
    setErrorMsg(null);
    mutation.mutate({
      organizationId: organization.id,
      legalName: legalName.trim(),
      tradeName: tradeName.trim() === "" ? null : tradeName.trim(),
      taxId: taxId.trim(),
      nrc: nrc.trim() === "" ? null : nrc.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Identidad fiscal</DialogTitle>
          <DialogDescription>{displayName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="fiscal-legal-name">Razón social</Label>
            <Input
              id="fiscal-legal-name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              disabled={isPending}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fiscal-trade-name">Nombre comercial</Label>
            <Input
              id="fiscal-trade-name"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              disabled={isPending}
              maxLength={200}
              placeholder="Opcional"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fiscal-tax-id">NIT</Label>
            <Input
              id="fiscal-tax-id"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              disabled={isPending}
              maxLength={40}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fiscal-nrc">NRC</Label>
            <Input
              id="fiscal-nrc"
              value={nrc}
              onChange={(e) => setNrc(e.target.value)}
              disabled={isPending}
              maxLength={20}
              placeholder="Opcional — Registro de Contribuyente, Hacienda SV"
            />
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
            disabled={isPending || isUnchanged || !legalNameValid || !taxIdValid}
          >
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
