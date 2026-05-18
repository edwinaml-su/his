"use client";

/**
 * SubstitutionModal — US.F2.6.11.
 *
 * Permite al farmacéutico solicitar una sustitución genérico-comercial
 * cuando el GTIN original está sin stock. Muestra estado en tiempo real
 * (polling cada 15 s) y bloquea el despacho hasta obtener decisión médica.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

interface SubstitutionTarget {
  prescriptionId: string;
  prescriptionItemId: string;
  drugName: string;
  /** GTIN-14 del medicamento original (puede ser string o null si no asignado) */
  gtinOriginal: string;
}

interface SubstitutionModalProps {
  target: SubstitutionTarget | null;
  onClose: () => void;
  onProposed: (substitutionId: string) => void;
}

type SubstitutionStatus = "PENDIENTE_AUTORIZACION" | "AUTORIZADA" | "RECHAZADA";

interface StatusViewProps {
  substitutionId: string;
  onClose: () => void;
}

/**
 * Muestra el estado actual de una sustitución propuesta con polling 15 s.
 */
function SubstitutionStatusView({ substitutionId, onClose }: StatusViewProps): React.ReactElement {
  const { data, refetch } = trpcAny.pharmacySubstitution.getStatus.useQuery(
    { substitutionId },
    { refetchInterval: 15_000 },
  );

  const status: SubstitutionStatus | undefined = data?.status;

  const statusLabel: Record<SubstitutionStatus, string> = {
    PENDIENTE_AUTORIZACION: "Pendiente de autorización médica",
    AUTORIZADA: "Autorizada — puede proceder con el despacho",
    RECHAZADA: "Rechazada — solicite nueva receta con el GTIN alternativo",
  };

  const statusColor: Record<SubstitutionStatus, string> = {
    PENDIENTE_AUTORIZACION: "text-amber-600 bg-amber-50 border-amber-300",
    AUTORIZADA: "text-green-700 bg-green-50 border-green-300",
    RECHAZADA: "text-destructive bg-destructive/10 border-destructive/40",
  };

  return (
    <div className="space-y-4">
      {status ? (
        <div
          className={`rounded-md border px-4 py-3 text-sm font-medium ${statusColor[status]}`}
          role="status"
          aria-live="polite"
        >
          {statusLabel[status]}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Cargando estado…</p>
      )}

      {data?.motivo ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium">Motivo médico:</span> {data.motivo}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
          Actualizar
        </Button>
        <Button type="button" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}

/**
 * Formulario para proponer la sustitución.
 */
function ProposeForm({
  target,
  onClose,
  onProposed,
}: {
  target: SubstitutionTarget;
  onClose: () => void;
  onProposed: (id: string) => void;
}): React.ReactElement {
  const [gtinSustituto, setGtinSustituto] = React.useState("");
  const [serverError, setServerError] = React.useState<string | null>(null);

  const proposeMutation = trpcAny.pharmacySubstitution.proposeSubstitution.useMutation({
    onSuccess: (data: { substitutionId: string }) => {
      onProposed(data.substitutionId);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    if (!/^\d{14}$/.test(gtinSustituto)) {
      setServerError("El GTIN sustituto debe tener exactamente 14 dígitos.");
      return;
    }

    proposeMutation.mutate({
      prescriptionId: target.prescriptionId,
      prescriptionItemId: target.prescriptionItemId,
      gtinOriginal: target.gtinOriginal,
      gtinSustituto,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label>GTIN original (sin stock)</Label>
        <p className="rounded-md bg-muted px-3 py-2 font-mono text-sm">
          {target.gtinOriginal}
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="gtin-sustituto">
          GTIN sustituto <span className="text-destructive">*</span>
        </Label>
        <Input
          id="gtin-sustituto"
          value={gtinSustituto}
          onChange={(e) => setGtinSustituto(e.target.value.replace(/\D/g, "").slice(0, 14))}
          placeholder="14 dígitos"
          maxLength={14}
          pattern="\d{14}"
          inputMode="numeric"
          autoFocus
          aria-describedby={serverError ? "sub-error" : undefined}
          aria-invalid={Boolean(serverError)}
        />
        <p className="text-xs text-muted-foreground">
          Debe existir una relación AUTORIZADA en el catálogo de equivalencias.
        </p>
      </div>

      {serverError ? (
        <p
          id="sub-error"
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {serverError}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={proposeMutation.isPending || gtinSustituto.length < 14}
        >
          {proposeMutation.isPending ? "Solicitando…" : "Solicitar sustitución"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SubstitutionModal({
  target,
  onClose,
  onProposed,
}: SubstitutionModalProps): React.ReactElement {
  const [proposedId, setProposedId] = React.useState<string | null>(null);

  // Reset al cambiar de target
  React.useEffect(() => {
    setProposedId(null);
  }, [target?.prescriptionItemId]);

  const handleProposed = (id: string) => {
    setProposedId(id);
    onProposed(id);
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar sustitución de medicamento</DialogTitle>
          {target ? (
            <DialogDescription>
              {target.drugName} — GTIN {target.gtinOriginal}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {target ? (
          proposedId ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sustitución enviada al médico prescriptor para autorización.
              </p>
              <SubstitutionStatusView substitutionId={proposedId} onClose={onClose} />
            </div>
          ) : (
            <ProposeForm target={target} onClose={onClose} onProposed={handleProposed} />
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
