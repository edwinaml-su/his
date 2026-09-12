"use client";

/**
 * US.F2.6.8-9 — Dispensación GS1 con reserva lógica y detección de duplicados.
 *
 * PR #581 — usa el router consolidado `dispensation` (antes pharmacyDispensation,
 * que NO validaba inventario): reserveItem ahora aplica el hard stop R07
 * (STOCK_INSUFICIENTE / LOTE_NO_EXISTE_EN_INVENTARIO / LOTE_NO_DISPONIBLE_
 * INVENTARIO) con descuento atómico de StockLot. La página además fetchea la
 * receta (orderDetail) para mostrar paciente y medicamentos reales en lugar de
 * pedir UUIDs tipeados a mano.
 *
 * Flujo:
 *  1. orderDetail → paciente + ítems de la receta firmada.
 *  2. Ingreso del scan GS1 (GTIN, lote, serie) + selección del ítem.
 *  3. checkDuplicate → Hard Stop si ítem ya dispensado en ventana terapéutica.
 *  4. reserveItem → hard stop de inventario + bloquea el serial al paciente.
 *  5. Botón "Cancelar Reserva" con confirmación + motivo (repone stock).
 *  6. SQL 232 — Botón "Registrar devolución" (returnItem): cierra el ciclo
 *     de la requisición cuando lo ya dispensado (reserva activa == la
 *     única fuente de "despachado" que produce este flujo hoy, ver
 *     dispensation.router.ts RETURN_ITEM_OPEN_STATUSES) NO se administra
 *     (alta/incumplimiento/vencimiento/otro) y regresa al botiquín. Motivo
 *     catalogado + testigo/PIN/justificación si el ítem es RX_CONTROLLED
 *     (no hay UI previa que capture esos campos — se construye aquí desde
 *     cero, ver nota en el componente).
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
import { Textarea } from "@his/ui/components/textarea";
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
import { SubstitutionModal } from "../../_components/substitution-modal";

interface CostCenterOption {
  id: string;
  code: string;
  name: string;
}

interface ScanFormState {
  gtin: string;
  lote: string;
  serie: string;
  prescriptionItemId: string;
}

interface OrderDetail {
  id: string;
  status: string;
  patientId: string;
  patient: { firstName: string; lastName: string; mrn: string };
  items: Array<{
    id: string;
    dosage: string;
    route: string;
    frequency: string;
    drug: { id: string; genericName: string };
  }>;
}

/** Hard stops del servidor (reserva + inventario R07) mapeados a mensaje UI. */
const HARD_STOP_DETAIL: Record<string, string> = {
  SERIAL_YA_RESERVADO_OTRO_PACIENTE:
    "Este número de serie ya está reservado para otro paciente.",
  SIN_RECETA_ACTIVA:
    "No existe receta activa firmada y dispensable para este paciente.",
  STOCK_INSUFICIENTE:
    "No hay existencias del lote escaneado en la bodega. Verifique el inventario antes de dispensar.",
  LOTE_NO_EXISTE_EN_INVENTARIO:
    "El lote escaneado nunca ingresó al inventario de esta bodega.",
  LOTE_NO_DISPONIBLE_INVENTARIO:
    "El lote está bloqueado (cuarentena/recall) y no puede dispensarse.",
};

interface HardStop {
  reason: string;
  detail: string;
}

/** Target de sustitución — misma forma que `SubstitutionTarget` en substitution-modal.tsx. */
interface SubstitutionTarget {
  prescriptionId: string;
  prescriptionItemId: string;
  drugName: string;
  gtinOriginal: string;
}

export default function GS1DispensePage(): React.ReactElement {
  const params = useParams();
  const orderId = params["orderId"] as string;
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  // El proxy de hooks (`trpc.*`) NO tiene `.fetch()` imperativo — eso vive en
  // useUtils(). Llamarlo sobre el proxy lanza TypeError en runtime y bloqueaba
  // TODO el flujo de escaneo (hallazgo E2E RN-HIS-BOT-001, 2026-09-12).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utilsAny = trpc.useUtils() as any;

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

  // Receta que actúa como orden de farmacia: paciente + ítems reales (PR #581).
  const orderQuery = trpcAny.dispensation.orderDetail.useQuery(
    { pharmacyOrderId: orderId },
    { retry: false },
  );
  const order = orderQuery.data as OrderDetail | undefined;

  const [form, setForm] = React.useState<ScanFormState>({
    gtin: "",
    lote: "",
    serie: "",
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

  // SQL 232 — devolución post-despacho (returnItem). Los campos de testigo
  // son opcionales en el formulario (el servidor los exige solo si el ítem
  // resuelve RX_CONTROLLED) — no hay UI previa en el proyecto que capture
  // 2-eyes de controlados para replicar; este es el primer caso.
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [returnMotivo, setReturnMotivo] = React.useState("");
  const [returnNotas, setReturnNotas] = React.useState("");
  const [returnWitnessUserId, setReturnWitnessUserId] = React.useState("");
  const [returnWitnessPin, setReturnWitnessPin] = React.useState("");
  const [returnJustification, setReturnJustification] = React.useState("");
  const [returnError, setReturnError] = React.useState<string | null>(null);

  // Sustitución genérico-comercial (US.F2.6.11) — bloquea el despacho del
  // ítem hasta que el médico prescriptor autorice.
  const [substitutionTarget, setSubstitutionTarget] =
    React.useState<SubstitutionTarget | null>(null);
  const [blockedItemId, setBlockedItemId] = React.useState<string | null>(null);

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

  // Auto-seleccionar el ítem cuando la receta tiene uno solo.
  React.useEffect(() => {
    const only = order?.items.length === 1 ? order.items[0] : null;
    if (only && !form.prescriptionItemId) {
      setForm((f) => ({ ...f, prescriptionItemId: only.id }));
    }
  }, [order, form.prescriptionItemId]);

  const selectedItem =
    order?.items.find((it) => it.id === form.prescriptionItemId) ?? null;

  const reserveMutation = trpcAny.dispensation.reserveItem.useMutation({
    onSuccess: (data: { id: string }) => {
      setReservationId(data.id);
      setReservedAt(new Date());
      setServerError(null);
    },
    onError: (err: { message: string }) => {
      const msg = err.message;
      const detail = HARD_STOP_DETAIL[msg];
      if (detail) {
        setHardStop({ reason: msg, detail });
      } else {
        setServerError(msg);
      }
    },
  });

  const cancelMutation = trpcAny.dispensation.cancelReservation.useMutation({
    onSuccess: () => {
      setReservationId(null);
      setReservedAt(null);
      setCancelOpen(false);
      setCancelMotivo("");
      setCancelError(null);
    },
    onError: (err: { message: string }) => setCancelError(err.message),
  });

  const returnMutation = trpcAny.dispensation.returnItem.useMutation({
    onSuccess: () => {
      setReservationId(null);
      setReservedAt(null);
      setReturnOpen(false);
      setReturnMotivo("");
      setReturnNotas("");
      setReturnWitnessUserId("");
      setReturnWitnessPin("");
      setReturnJustification("");
      setReturnError(null);
    },
    onError: (err: { message: string }) => setReturnError(err.message),
  });

  // Mientras haya una sustitución propuesta para el ítem actual, consulta si
  // ya fue autorizada por el médico (poll 15 s, igual cadencia que el modal).
  const authorizedSubstitutionsQuery =
    trpcAny.pharmacySubstitution.listAuthorizedForItem.useQuery(
      { prescriptionItemId: blockedItemId ?? "" },
      { enabled: Boolean(blockedItemId), refetchInterval: 15_000 },
    );
  const isSubstitutionAuthorized =
    ((authorizedSubstitutionsQuery.data as unknown[] | undefined)?.length ?? 0) > 0;
  const isCurrentItemBlocked =
    blockedItemId !== null &&
    blockedItemId === form.prescriptionItemId &&
    !isSubstitutionAuthorized;

  function validate(): boolean {
    const e: Partial<ScanFormState> = {};
    if (!/^\d{14}$/.test(form.gtin)) e.gtin = "GTIN-14: 14 dígitos numéricos";
    if (!form.lote.trim()) e.lote = "Lote requerido";
    if (!form.prescriptionItemId.trim())
      e.prescriptionItemId = "Seleccione el medicamento a dispensar";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    if (!validate()) return;
    setHardStop(null);
    setServerError(null);
    setCheckPending(true);

    try {
      // 1. checkDuplicate primero (US.F2.6.9)
      // Usamos fetch directo para query síncrona inline sin hook condicional
      const checkResult = await (
        utilsAny.dispensation.checkDuplicate.fetch({
          patientId: order.patientId,
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

      // 2. Reservar serial (US.F2.6.8) — con hard stop de inventario server-side
      reserveMutation.mutate({
        pharmacyOrderId: orderId,
        gtin: form.gtin,
        lote: form.lote,
        serie: form.serie.trim() || undefined,
        patientId: order.patientId,
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

  function handleReturnConfirm() {
    if (!returnMotivo) {
      setReturnError("Seleccione el motivo de la devolución");
      return;
    }
    if (!reservationId) return;
    returnMutation.mutate({
      reservationId,
      motivo: returnMotivo,
      notas: returnNotas.trim() || undefined,
      witnessUserId: returnWitnessUserId.trim() || undefined,
      witnessPin: returnWitnessPin.trim() || undefined,
      controlledJustification: returnJustification.trim() || undefined,
    });
  }

  /**
   * Abre el modal de sustitución para el GTIN/ítem actuales cuando el
   * farmacéutico determina que no hay stock del medicamento original.
   */
  function handleRequestSubstitution() {
    const e: Partial<ScanFormState> = {};
    if (!/^\d{14}$/.test(form.gtin)) e.gtin = "GTIN-14: 14 dígitos numéricos";
    if (!form.prescriptionItemId.trim())
      e.prescriptionItemId = "ID de ítem de receta requerido";
    if (Object.keys(e).length > 0) {
      setErrors((prev) => ({ ...prev, ...e }));
      return;
    }
    setSubstitutionTarget({
      prescriptionId: orderId,
      prescriptionItemId: form.prescriptionItemId,
      drugName: `Medicamento (GTIN ${form.gtin})`,
      gtinOriginal: form.gtin,
    });
  }

  function handleSubstitutionProposed() {
    setBlockedItemId(form.prescriptionItemId);
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
          {order ? (
            <p className="text-sm font-medium">
              {order.patient.firstName} {order.patient.lastName}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                MRN {order.patient.mrn} · {order.items.length} ítem
                {order.items.length !== 1 ? "s" : ""}
              </span>
            </p>
          ) : null}
        </div>
      </div>

      {/* Receta no encontrada / sin acceso */}
      {orderQuery.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          No se pudo cargar la receta de esta orden:{" "}
          {(orderQuery.error as { message?: string }).message ?? "error desconocido"}
        </div>
      ) : null}

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
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReturnOpen(true)}
            >
              Registrar devolución
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setCancelOpen(true)}
            >
              Cancelar reserva
            </Button>
          </div>
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

      {/* Sustitución genérico-comercial pendiente — bloquea el despacho */}
      {isCurrentItemBlocked ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3"
        >
          <p className="font-semibold text-amber-700">
            Despacho bloqueado — sustitución pendiente de autorización médica
          </p>
          <p className="mt-1 text-sm text-amber-700">
            Se solicitó sustituir el GTIN {form.gtin}. No podrá reservar este
            ítem hasta que el médico prescriptor autorice la sustitución.
          </p>
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
              <Label htmlFor="gs1-item">
                Medicamento de la receta{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.prescriptionItemId}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, prescriptionItemId: v }))
                }
                disabled={Boolean(reservationId) || !order}
              >
                <SelectTrigger
                  id="gs1-item"
                  aria-invalid={Boolean(errors.prescriptionItemId)}
                >
                  <SelectValue
                    placeholder={
                      orderQuery.isLoading
                        ? "Cargando receta…"
                        : "Seleccione el medicamento"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(order?.items ?? []).map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.drug.genericName} — {it.dosage} · {it.frequency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={isPending || !order || isCurrentItemBlocked}
                >
                  {isPending ? "Verificando…" : "Validar y reservar"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    isPending ||
                    !order ||
                    (blockedItemId !== null && blockedItemId === form.prescriptionItemId)
                  }
                  onClick={handleRequestSubstitution}
                >
                  Solicitar Sustitución
                </Button>
              </div>
            ) : (
              <p className="text-sm text-green-700">
                {selectedItem
                  ? `${selectedItem.drug.genericName} reservado correctamente.`
                  : "Unidad reservada correctamente."}{" "}
                Confirme el despacho desde el sistema de farmacia.
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

      {/* SQL 232 — Dialog devolución post-despacho (returnItem) */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar devolución</DialogTitle>
            <DialogDescription>
              El medicamento/insumo ya despachado NO se administró (o debe
              regresar al botiquín). Esto cierra el ciclo de la requisición y
              revierte el cargo de la cuenta del paciente.
            </DialogDescription>
          </DialogHeader>

          <FormField>
            <Label htmlFor="return-motivo">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Select value={returnMotivo} onValueChange={setReturnMotivo}>
              <SelectTrigger id="return-motivo">
                <SelectValue placeholder="Seleccione el motivo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NO_ADMINISTRADO">No administrado</SelectItem>
                <SelectItem value="ALTA">Alta del paciente</SelectItem>
                <SelectItem value="INCUMPLIMIENTO">Incumplimiento</SelectItem>
                <SelectItem value="VENCIMIENTO">Vencimiento</SelectItem>
                <SelectItem value="OTRO">Otro</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField>
            <Label htmlFor="return-notas">Notas (opcional)</Label>
            <Textarea
              id="return-notas"
              value={returnNotas}
              onChange={(e) => setReturnNotas(e.target.value)}
              placeholder="Detalle adicional de la devolución"
              maxLength={1000}
            />
          </FormField>

          <div className="rounded-md border border-muted-foreground/20 p-3">
            <p className="text-xs text-muted-foreground">
              Solo si el medicamento es controlado (RX_CONTROLLED): testigo
              distinto del dispensador y del prescriptor, con PIN de firma
              electrónica.
            </p>
            <FormField>
              <Label htmlFor="return-witness-id">ID de usuario testigo</Label>
              <Input
                id="return-witness-id"
                value={returnWitnessUserId}
                onChange={(e) => setReturnWitnessUserId(e.target.value)}
                placeholder="UUID del testigo"
              />
            </FormField>
            <FormField>
              <Label htmlFor="return-witness-pin">PIN del testigo</Label>
              <Input
                id="return-witness-pin"
                type="password"
                value={returnWitnessPin}
                onChange={(e) => setReturnWitnessPin(e.target.value)}
                maxLength={8}
              />
            </FormField>
            <FormField>
              <Label htmlFor="return-justification">Justificación</Label>
              <Textarea
                id="return-justification"
                value={returnJustification}
                onChange={(e) => setReturnJustification(e.target.value)}
                placeholder="Justificación legal de la devolución de fármaco controlado"
                maxLength={500}
              />
            </FormField>
          </div>

          {returnError ? <FormError>{returnError}</FormError> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReturnOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="button"
              disabled={returnMutation.isPending}
              onClick={handleReturnConfirm}
            >
              {returnMutation.isPending ? "Registrando…" : "Confirmar devolución"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de sustitución genérico-comercial (US.F2.6.11) */}
      <SubstitutionModal
        target={substitutionTarget}
        onClose={() => setSubstitutionTarget(null)}
        onProposed={handleSubstitutionProposed}
      />
    </div>
  );
}
