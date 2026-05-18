"use client";

/**
 * Acciones de fila para la tabla de GSRN profesionales:
 * - Revocar (con motivo)
 * - Ver / reimprimir badge DataMatrix
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { DatamatrixPreview } from "./datamatrix-preview";
import { trpc } from "@/lib/trpc/react";

interface StaffGsrnActionsProps {
  id:     string;
  gsrn:   string;
  nombre: string | null;
  rol:    string | null;
  status: "ACTIVE" | "REVOKED";
  onRevoked: () => void;
}

export function StaffGsrnActions({
  id,
  gsrn,
  nombre,
  rol,
  status,
  onRevoked,
}: StaffGsrnActionsProps) {
  const [revokeOpen, setRevokeOpen]   = React.useState(false);
  const [badgeOpen, setBadgeOpen]     = React.useState(false);
  const [motivo, setMotivo]           = React.useState("");
  const [errorMsg, setErrorMsg]       = React.useState<string | null>(null);

  const utils = trpc.useUtils();

  const revoke = trpc.staffGsrn.revoke.useMutation({
    onSuccess: () => {
      void utils.staffGsrn.list.invalidate();
      setRevokeOpen(false);
      setMotivo("");
      onRevoked();
    },
    onError: (e) => setErrorMsg(e.message),
  });

  const badgeQuery = trpc.staffGsrn.printBadge.useQuery(
    { id },
    { enabled: badgeOpen },
  );

  function handleRevoke(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    revoke.mutate({ id, motivo });
  }

  return (
    <>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setBadgeOpen(true)}
          aria-label={`Ver badge de ${nombre ?? gsrn}`}
        >
          Badge
        </Button>

        {status === "ACTIVE" && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setRevokeOpen(true)}
            aria-label={`Revocar GSRN de ${nombre ?? gsrn}`}
          >
            Revocar
          </Button>
        )}
      </div>

      {/* Dialog: Badge DataMatrix */}
      <Dialog open={badgeOpen} onOpenChange={setBadgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Badge institucional — DataMatrix</DialogTitle>
          </DialogHeader>

          {badgeQuery.isPending && (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          )}
          {badgeQuery.data && (
            <div className="flex justify-center py-4">
              <DatamatrixPreview
                gs1Payload={badgeQuery.data.gs1Payload}
                nombre={badgeQuery.data.nombre}
                rol={badgeQuery.data.rol}
                gsrn={badgeQuery.data.gsrn}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Revocar */}
      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revocar GSRN profesional</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRevoke} className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Profesional: <strong>{nombre ?? "—"}</strong>
              <br />
              GSRN: <code className="font-mono text-xs">{gsrn}</code>
            </p>
            <div className="space-y-1">
              <Label htmlFor="motivo">Motivo de revocación</Label>
              <Input
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej. Licencia suspendida por Junta de Vigilancia"
                required
                maxLength={500}
              />
            </div>

            {errorMsg && (
              <p role="alert" className="rounded bg-destructive/10 p-2 text-sm text-destructive">
                {errorMsg}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRevokeOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={revoke.isPending || !motivo.trim()}
              >
                {revoke.isPending ? "Revocando..." : "Confirmar revocación"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
