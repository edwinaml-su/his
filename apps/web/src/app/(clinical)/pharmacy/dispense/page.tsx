"use client";

/**
 * §15 Pharmacy — Despacho de medicación.
 *
 * Lista las recetas SIGNED o PARTIALLY_DISPENSED y permite despachar
 * cada item individualmente. Se eligió un Dialog modal (en lugar de un
 * inline form) porque el despacho requiere captura de batch + expiry y
 * confirmación atómica; embebido en la fila ocuparía demasiado espacio
 * y dificultaría a11y.
 *
 * Filtro client-side: la query general devuelve toda la lista y aquí
 * sólo se muestran las que están en estados elegibles.
 */
import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormError, FormField } from "@his/ui/components/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { dispenseCreateInput } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import {
  PrescriptionStatusBadge,
  type PrescriptionStatus,
} from "../_components/prescription-status-badge";

interface DispenseRecord {
  id: string;
  quantity: number;
  dispensedAt: string | Date;
}

interface PrescriptionItemRecord {
  id: string;
  dosage: string;
  route: string;
  frequency: string;
  drug: {
    id: string;
    genericName: string;
    brandName?: string | null;
    strengthValue?: string | number | null;
    strengthUnit?: string | null;
  };
  dispenses: DispenseRecord[];
}

interface PrescriptionRecord {
  id: string;
  status: PrescriptionStatus;
  prescribedAt: string | Date;
  patient: { id: string; firstName: string; lastName: string; mrn: string };
  encounter: { id: string; encounterNumber: string };
  items: PrescriptionItemRecord[];
}

const ELIGIBLE_STATUSES: PrescriptionStatus[] = [
  "SIGNED",
  "PARTIALLY_DISPENSED",
];

export default function PharmacyDispensePage(): React.ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const utils = trpcAny.useUtils?.();
  const list = trpcAny.pharmacy.prescription.list.useQuery({});
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [dispenseTarget, setDispenseTarget] = React.useState<{
    prescriptionId: string;
    item: PrescriptionItemRecord;
  } | null>(null);

  const all = (list.data?.items ?? list.data ?? []) as PrescriptionRecord[];
  const eligible = all.filter((rx) => ELIGIBLE_STATUSES.includes(rx.status));

  const handleDispenseSuccess = () => {
    setDispenseTarget(null);
    if (utils?.pharmacy?.prescription?.list?.invalidate) {
      utils.pharmacy.prescription.list.invalidate();
    } else {
      list.refetch();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Despachar medicación</h1>
        <p className="text-sm text-muted-foreground">
          Recetas firmadas pendientes o con despacho parcial.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recetas elegibles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay recetas pendientes de despacho.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {eligible.map((rx) => {
                const isOpen = expanded === rx.id;
                return (
                  <li key={rx.id}>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : rx.id)}
                      aria-expanded={isOpen}
                      aria-controls={`rx-items-${rx.id}`}
                      className="flex w-full items-center justify-between px-3 py-3 text-left text-sm hover:bg-accent"
                    >
                      <div>
                        <p className="font-semibold">
                          {rx.patient.firstName} {rx.patient.lastName}
                          <span className="ml-2 text-xs text-muted-foreground">
                            MRN {rx.patient.mrn} ·{" "}
                            {rx.encounter.encounterNumber}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(rx.prescribedAt).toLocaleString("es-SV")} ·{" "}
                          {rx.items.length} ítems
                        </p>
                      </div>
                      <PrescriptionStatusBadge status={rx.status} />
                    </button>
                    {isOpen ? (
                      <div
                        id={`rx-items-${rx.id}`}
                        className="bg-muted/40 px-3 py-2"
                      >
                        <ul className="space-y-2">
                          {rx.items.map((it) => {
                            const strength =
                              it.drug.strengthValue != null &&
                              it.drug.strengthUnit
                                ? `${it.drug.strengthValue}${it.drug.strengthUnit}`
                                : "";
                            return (
                              <li
                                key={it.id}
                                className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-sm"
                              >
                                <div>
                                  <p className="font-medium">
                                    {it.drug.genericName}
                                    {strength ? ` ${strength}` : ""}
                                    {it.drug.brandName
                                      ? ` (${it.drug.brandName})`
                                      : ""}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {it.dosage} · {it.route} · {it.frequency} ·{" "}
                                    {it.dispenses.length} despachos previos
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() =>
                                    setDispenseTarget({
                                      prescriptionId: rx.id,
                                      item: it,
                                    })
                                  }
                                >
                                  Despachar
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <DispenseDialog
        target={dispenseTarget}
        onClose={() => setDispenseTarget(null)}
        onSuccess={handleDispenseSuccess}
      />
    </div>
  );
}

interface DispenseDialogProps {
  target: { prescriptionId: string; item: PrescriptionItemRecord } | null;
  onClose: () => void;
  onSuccess: () => void;
}

function DispenseDialog({
  target,
  onClose,
  onSuccess,
}: DispenseDialogProps): React.ReactElement {
  const [quantity, setQuantity] = React.useState("");
  const [batchNumber, setBatchNumber] = React.useState("");
  const [expiryDate, setExpiryDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const dispenseMutation = trpcAny.pharmacy.dispense.create.useMutation({
    onSuccess: () => {
      setQuantity("");
      setBatchNumber("");
      setExpiryDate("");
      setNotes("");
      setErrors({});
      setServerError(null);
      onSuccess();
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  // Reset al cambiar de target
  React.useEffect(() => {
    setQuantity("");
    setBatchNumber("");
    setExpiryDate("");
    setNotes("");
    setErrors({});
    setServerError(null);
  }, [target?.item.id]);

  const isOpen = target !== null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setServerError(null);

    const candidate = {
      prescriptionItemId: target.item.id,
      quantity: Number(quantity),
      ...(batchNumber.trim() ? { batchNumber: batchNumber.trim() } : {}),
      ...(expiryDate ? { expiryDate: new Date(expiryDate) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };

    const parsed = dispenseCreateInput.safeParse(candidate);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const issue of parsed.error.errors) {
        const k = String(issue.path[0] ?? "_");
        if (!fe[k]) fe[k] = issue.message;
      }
      setErrors(fe);
      return;
    }
    setErrors({});
    dispenseMutation.mutate(parsed.data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Despachar medicamento</DialogTitle>
          {target ? (
            <DialogDescription>
              {target.item.drug.genericName}
              {target.item.drug.strengthValue != null &&
              target.item.drug.strengthUnit
                ? ` ${target.item.drug.strengthValue}${target.item.drug.strengthUnit}`
                : ""}{" "}
              · {target.item.dosage}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {target ? (
          <Form onSubmit={handleSubmit}>
            <FormField>
              <Label htmlFor="dispense-qty">
                Cantidad <span className="text-destructive">*</span>
              </Label>
              <Input
                id="dispense-qty"
                type="number"
                min="1"
                step="1"
                autoFocus
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                aria-invalid={Boolean(errors.quantity)}
              />
              <FormError>{errors.quantity}</FormError>
            </FormField>
            <FormField>
              <Label htmlFor="dispense-batch">Lote</Label>
              <Input
                id="dispense-batch"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                aria-invalid={Boolean(errors.batchNumber)}
              />
              <FormError>{errors.batchNumber}</FormError>
            </FormField>
            <FormField>
              <Label htmlFor="dispense-exp">Vencimiento</Label>
              <Input
                id="dispense-exp"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                aria-invalid={Boolean(errors.expiryDate)}
              />
              <FormError>{errors.expiryDate}</FormError>
            </FormField>
            <FormField>
              <Label htmlFor="dispense-notes">Notas</Label>
              <textarea
                id="dispense-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </FormField>

            {serverError ? (
              <p
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
              <Button type="submit" disabled={dispenseMutation.isPending}>
                {dispenseMutation.isPending ? "Despachando…" : "Despachar"}
              </Button>
            </DialogFooter>
          </Form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
