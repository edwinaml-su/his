"use client";

/**
 * Formulario de alta de GSRN profesional.
 *
 * Permite registrar un GSRN para un usuario del sistema con opción de:
 * - Ingresar el código manualmente (validado Módulo-10)
 * - Generar automáticamente (autoGenerate)
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

interface StaffGsrnFormProps {
  onSuccess: () => void;
  onCancel:  () => void;
}

export function StaffGsrnForm({ onSuccess, onCancel }: StaffGsrnFormProps) {
  const [userId, setUserId]       = React.useState("");
  const [gsrn, setGsrn]           = React.useState("");
  const [autoGen, setAutoGen]     = React.useState(true);
  const [errorMsg, setErrorMsg]   = React.useState<string | null>(null);

  const utils = trpc.useUtils();
  const create = trpc.staffGsrn.create.useMutation({
    onSuccess: () => {
      void utils.staffGsrn.list.invalidate();
      onSuccess();
    },
    onError: (e) => setErrorMsg(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    create.mutate({
      userId,
      gsrn:         autoGen ? undefined : gsrn || undefined,
      autoGenerate: autoGen,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="userId">ID de usuario (UUID)</Label>
        <Input
          id="userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          required
          pattern="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="autoGen"
          type="checkbox"
          checked={autoGen}
          onChange={(e) => setAutoGen(e.target.checked)}
          className="h-4 w-4 rounded border"
        />
        <Label htmlFor="autoGen">Generar GSRN automáticamente</Label>
      </div>

      {!autoGen && (
        <div className="space-y-1">
          <Label htmlFor="gsrn">GSRN (18 dígitos)</Label>
          <Input
            id="gsrn"
            value={gsrn}
            onChange={(e) => setGsrn(e.target.value.replace(/\D/g, "").slice(0, 18))}
            placeholder="801234567890000001"
            maxLength={18}
            pattern="\d{18}"
          />
          <p className="text-xs text-muted-foreground">
            Formato GS1: 18 dígitos con verificador Módulo-10
          </p>
        </div>
      )}

      {errorMsg && (
        <p role="alert" className="rounded bg-destructive/10 p-2 text-sm text-destructive">
          {errorMsg}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Guardando..." : "Registrar GSRN"}
        </Button>
      </div>
    </form>
  );
}
