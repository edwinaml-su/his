"use client";

/**
 * US.F2.6.8-9 — Dispensación GS1 con reserva lógica y detección de duplicados.
 *
 * Flujo:
 *  1. Ingreso del scan GS1 (GTIN, lote, serie).
 *  2. checkDuplicate → Hard Stop si ítem ya dispensado en ventana terapéutica.
 *  3. reserveItem → bloquea el serial al paciente. Muestra contador 4h.
 *  4. Botón "Cancelar Reserva" con confirmación + motivo.
 *  5. Banner visual mientras la reserva está activa.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

interface CostCenterOption {
  id: string;
  code: string;
  name: string;
}

interface ScanFormState {
  gtin: string;
  lote: string;
  serie: string;
  patientId: string;
  prescriptionItemId: string;
}

type HardStopReason =
  | "ITEM_YA_DISPENSADO_EN_VENTANA"
  | "SERIAL_YA_RESERVADO_OTRO_PACIENTE";

interface HardStop {
  reason: HardStopReason;
  detail: string;
}

export default function GS1DispensePage(): React.ReactElement {
  const params = useParams();
  const orderId = params["orderId"] as string;
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;

  // Centros de costo: carga todos los intermedios (2-XXX-XXX) + pre-selecciona 2-FAR-HOS.
  const costCentersQuery = trpcAny.costCenter.list.useQuery(
    { activo: true },
    { staleTime: 60_000 },
  );
  const dispenseCostCenterOptions = React.useMemo(() => {
    const all = (costCentersQuery.data ?? []) as CostCenterOption[];
    return all.filter((cc) => cc.code.startsWith("2-"));
  }, [costCentersQuery.data]);

  const defaultDispenseCcId = React.useMemo(() => {
    const all = (costCentersQuery.data ?? []) as CostCenterOption[];
    return all.find((cc) => cc.code === "2-FAR-HOS")?.id ?? "";
  }, [costCentersQuery.data]);

  const [dispenseCostCenterId, setDispenseCostCenterId] = React.useState("");

  // Pre-seleccionar 2-FAR-HOS en cuanto cargue.
  React.useEffect(() => {
    if (defaultDispenseCcId && !dispenseCostCenterId) {
      setDispenseCostCenterId(defaultDispenseCcId);
    }
  }, [defaultDispenseCcId, dispenseCostCenterId]);

  const [form, setForm] = React.useState<ScanFormState>({
    gtin: "",
    lote: "",
    serie: "",
    patientId: "",
    prescriptionItemId: "",
  });
  const [errors, setErrors] = React.useState<Partial<ScanFormState>>({});
  const [hardStop, setHardStop] = React.useState<HardStop | null>(null);
  const [reservationId, setReservationId] = React.useState<string | null>(null);
  const [reservedAt, setReservedAt] = React.useState<Date | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelMotivo, setCancelMotivo] = React.useState("");
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [checkPending, setCheckPending] = React.useState(false);

  // Contador tiempo restante
  const [minutosRestantes, setMinutosRestantes] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!reservedAt) {
      setMinutosRestantes(null);
      return;
    }
    const tick = () => {
      const diff = reservedAt.getTime() + 4 * 60 * 60 * 1000 - Date.now();
      if (diff <= 0) {
        setMinutosRestantes(0);
        setReservationId(null);
        return;
      }
      setMinutosRestantes(Math.ceil(diff / 60000));
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [reservedAt]);

  const checkDuplicateMutation = trpcAny.pharmacyDispensation.checkDuplicate.useQuery;

  const reserveMutation = trpcAny.pharmacyDispensation.reserveItem.useMutation({
    onSuccess: (data: { id: string }) => {
      setReservationId(data.id);
      setReservedAt(new Date());
      setServerError(null);
    },
    onError: (err: { message: string }) => {
      const msg = err.message;
      if (msg === "SERIAL_YA_RESERVADO_OTRO_PACIENTE") {
        setHardStop({
          reason: "SERIAL_YA_RESERVADO_OTRO_PACIENTE",
          detail: "Este número de serie ya está reservado para otro paciente.",
        });
      } else {
        setServerError(msg);
      }
    },
  });

  const cancelMutation = trpcAny.pharmacyDispensation.cancelReservation.useMutation({
    onSuccess: () => {
      setReservationId(null);
      setReservedAt(null);
      setCancelOpen(false);
      setCancelMotivo("");
      setCancelError(null);
    },
    onError: (err: { message: string }) => setCancelError(err.message),
  });

  function validate(): boolean {
    const e: Partial<ScanFormState> = {};
    if (!/^\d{14}$/.test(form.gtin)) e.gtin = "GTIN-14: 14 dígitos numéricos";
    if (!form.lote.trim()) e.lote = "Lote requerido";
    if (!form.patientId.trim()) e.patientId = "ID de paciente requerido";
    if (!form.prescriptionItemId.trim())
      e.prescriptionItemId = "ID de ítem de receta requerido";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setHardStop(null);
    setServerError(null);
    setCheckPending(true);

    try {
      // 1. checkDuplicate primero (US.F2.6.9)
      // Usamos fetch directo para query síncrona inline sin hook condicional
      const checkResult = await (
        trpcAny.pharmacyDispensation.checkDuplicate.fetch({
          patientId: form.patientId,
          prescriptionItemId: form.prescriptionItemId,
          gtin: form.gtin,
        }) as Promise<{
          allowed: boolean;
          lastDispensedAt: string | null;
          nextWindowAt: string | null;
          reason?: string;
        }>
      );

      if (!checkResult.allowed) {
        const next = checkResult.nextWindowAt
          ? new Date(checkResult.nextWindowAt).toLocaleString("es-SV")
          : "—";
        setHardStop({
          reason: "ITEM_YA_DISPENSADO_EN_VENTANA",
          detail: `Ítem ya dispensado. Próxima ventana: ${next}`,
        });
        return;
      }

      // 2. Reservar serial (US.F2.6.8)
      reserveMutation.mutate({
        pharmacyOrderId: orderId,
        gtin: form.gtin,
        lote: form.lote,
        serie: form.serie.trim() || undefined,
        patientId: form.patientId,
      });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setCheckPending(false);
    }
  }

  function handleCancelConfirm() {
    if (!cancelMotivo.trim()) {
      setCancelError("El motivo de cancelación es requerido");
      return;
    }
    if (!reservationId) return;
    cancelMutation.mutate({
      reservationId,
      motivo: cancelMotivo.trim(),
    });
  }

  const isPending =
    checkPending || reserveMutation.isPending || cancelMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => router.back()}
        >
          Volver
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Dispensación GS1</h1>
          <p className="text-sm text-muted-foreground">
            Orden: <code className="font-mono text-xs">{orderId}</code>
          </p>
        </div>
      </div>

      {/* Banner reserva activa */}
      {reservationId && minutosRestantes !== null && minutosRestantes > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between rounded-md border border-green-500/40 bg-green-500/10 px-4 py-3"
        >
          <p className="text-sm font-medium text-green-700">
            Reserva activa — expira en{" "}
            <strong>{minutosRestantes} min</strong>
          </p>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setCancelOpen(true)}
          >
            Cancelar reserva
          </Button>
        </div>
      ) : null}

      {/* Banner reserva expirada */}
      {reservedAt && minutosRestantes === 0 ? (
        <div
          role="alert"
          className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700"
        >
          La reserva expiró. Escanee nuevamente para crear una nueva reserva.
        </div>
      ) : null}

      {/* Hard Stop */}
      {hardStop ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <p className="font-semibold text-destructive">
            HARD STOP — {hardStop.reason}
          </p>
          <p className="mt-1 text-sm text-destructive">{hardStop.detail}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setHardStop(null)}
          >
            Descartar
          </Button>
        </div>
      ) : null}

      {/* Formulario de scan */}
      <Card>
        <CardHeader>
          <CardTitle>Escanear unidad GS1</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={(e) => void handleScan(e)}>
            <FormField>
              <Label htmlFor="dispense-cc">Centro de costo dispensador</Label>
              <Select
                value={dispenseCostCenterId}
                onValueChange={setDispenseCostCenterId}
                disabled={Boolean(reservationId)}
              >
                <SelectTrigger id="dispense-cc">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  {dispenseCostCenterOptions.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label htmlFor="gs1-gtin">
                GTIN-14 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="gs1-gtin"
                placeholder="00000000000000"
                maxLength={14}
                value={form.gtin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, gtin: e.target.value }))
                }
                aria-invalid={Boolean(errors.gtin)}
                disabled={Boolean(reservationId)}
              />
              <FormError>{errors.gtin}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="gs1-lote">
                Lote <span className="text-destructive">*</span>
              </Label>
              <Input
                id="gs1-lote"
                placeholder="L2024A"
                maxLength={80}
                value={form.lote}
                onChange={(e) =>
                  setForm((f) => ({ ...f, lote: e.target.value }))
                }
                aria-invalid={Boolean(errors.lote)}
                disabled={Boolean(reservationId)}
              />
              <FormError>{errors.lote}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="gs1-serie">Serie (opcional)</Label>
              <Input
                id="gs1-serie"
                placeholder="21000001"
                maxLength={80}
                value={form.serie}
                onChange={(e) =>
                  setForm((f) => ({ ...f, serie: e.target.value }))
                }
                disabled={Boolean(reservationId)}
              />
            </FormField>

            <FormField>
              <Label htmlFor="gs1-patient">
                ID Paciente <span className="text-destructive">*</span>
              </Label>
              <Input
                id="gs1-patient"
                placeholder="UUID del paciente"
                value={form.patientId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, patientId: e.target.value }))
                }
                aria-invalid={Boolean(errors.patientId)}
                disabled={Boolean(reservationId)}
              />
              <FormError>{errors.patientId}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="gs1-item">
                ID Ítem de Receta <span className="text-destructive">*</span>
              </Label>
              <Input
                id="gs1-item"
                placeholder="UUID del ítem de prescripción"
                value={form.prescriptionItemId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    prescriptionItemId: e.target.value,
                  }))
                }
                aria-invalid={Boolean(errors.prescriptionItemId)}
                disabled={Boolean(reservationId)}
              />
              <FormError>{errors.prescriptionItemId}</FormError>
            </FormField>

            {serverError ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {serverError}
              </p>
            ) : null}

            {!reservationId ? (
              <Button type="submit" disabled={isPending}>
                {isPending ? "Verificando…" : "Validar y reservar"}
              </Button>
            ) : (
              <p className="text-sm text-green-700">
                Unidad reservada correctamente. Confirme el despacho desde el
                sistema de farmacia.
              </p>
            )}
          </Form>
        </CardContent>
      </Card>

      {/* Dialog cancelación */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar reserva</DialogTitle>
            <DialogDescription>
              Ingrese el motivo de cancelación. La unidad quedará disponible
              para otros pacientes.
            </DialogDescription>
          </DialogHeader>

          <FormField>
            <Label htmlFor="cancel-motivo">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cancel-motivo"
              value={cancelMotivo}
              onChange={(e) => setCancelMotivo(e.target.value)}
              placeholder="Ejemplo: orden médica suspendida"
              aria-invalid={Boolean(cancelError)}
              autoFocus
            />
            {cancelError ? (
              <FormError>{cancelError}</FormError>
            ) : null}
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={handleCancelConfirm}
            >
              {cancelMutation.isPending ? "Cancelando…" : "Confirmar cancelación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
