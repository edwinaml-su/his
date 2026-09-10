"use client";

/**
 * Diálogo crear/editar establecimiento — parametrización admin (2026-09-10).
 * `establishment === null` → modo alta; `establishment` con datos → edición.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

export type EstablishmentData = {
  id: string;
  code: string;
  name: string;
  addressLine: string | null;
  phone: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  establishment: EstablishmentData | null;
  onSaved: () => void;
};

export function EstablishmentDialog({ open, onOpenChange, establishment, onSaved }: Props) {
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [addressLine, setAddressLine] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const isEdit = establishment !== null;

  React.useEffect(() => {
    if (!open) return;
    setCode(establishment?.code ?? "");
    setName(establishment?.name ?? "");
    setAddressLine(establishment?.addressLine ?? "");
    setPhone(establishment?.phone ?? "");
    setErrorMsg(null);
  }, [open, establishment]);

  const createMutation = trpcAny.establishment.create.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const updateMutation = trpcAny.establishment.update.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const codeValid = code.trim().length >= 1;
  const nameValid = name.trim().length >= 1;

  function handleSubmit() {
    if (!codeValid || !nameValid) return;
    setErrorMsg(null);
    const trimmedAddress = addressLine.trim();
    const trimmedPhone = phone.trim();

    if (isEdit && establishment) {
      updateMutation.mutate({
        id: establishment.id,
        code: code.trim(),
        name: name.trim(),
        addressLine: trimmedAddress === "" ? null : trimmedAddress,
        phone: trimmedPhone === "" ? null : trimmedPhone,
      });
    } else {
      createMutation.mutate({
        code: code.trim(),
        name: name.trim(),
        addressLine: trimmedAddress === "" ? undefined : trimmedAddress,
        phone: trimmedPhone === "" ? undefined : trimmedPhone,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar establecimiento" : "Nuevo establecimiento"}</DialogTitle>
          <DialogDescription>
            {isEdit ? establishment?.name : "Alta de un establecimiento en la organización activa."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="est-code">Código</Label>
            <Input
              id="est-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={isPending}
              maxLength={40}
              placeholder="Ej. US"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="est-name">Nombre</Label>
            <Input
              id="est-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="est-address">Dirección</Label>
            <Input
              id="est-address"
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              disabled={isPending}
              maxLength={300}
              placeholder="Opcional"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="est-phone">Teléfono</Label>
            <Input
              id="est-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isPending}
              maxLength={40}
              placeholder="Opcional"
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
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending || !codeValid || !nameValid}>
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
