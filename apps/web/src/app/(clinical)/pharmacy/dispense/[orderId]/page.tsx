"use client";

/**
 * US.F2.6.7 — Estación de Picking Farmacia.
 *
 * Muestra los ítems de la receta y permite escanear el DataMatrix de cada
 * unidad. Hard stops:
 *   - GTIN_NO_COINCIDE_CON_RECETA
 *   - MEDICAMENTO_VENCIDO        (+ notificación outbox)
 *   - LOTE_EN_RECALL
 *
 * Feedback:
 *   - Beep verde (HTML5 Audio, 880 Hz) en scan correcto.
 *   - Beep rojo (HTML5 Audio, 220 Hz) en hard stop.
 *   - Modal full-screen rojo con razón del hard stop.
 *   - Botón "Finalizar Dispensación" habilitado solo cuando todos ESCANEADO.
 */
import * as React from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Gs1Scanner } from "@/components/gs1-scanner";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type ItemStatus = "PENDIENTE" | "ESCANEADO" | "HARD_STOP";

interface PickingItem {
  id: string;
  drugId: string;
  genericName: string;
  dosage: string;
  route: string;
  frequency: string;
  status: ItemStatus;
  hardStopReason?: string;
  scannedGtin?: string;
  scannedLot?: string;
  scannedExpiry?: string;
}

interface HardStopModal {
  visible: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Sonido (beep HTML5 Audio — no depende de librería externa)
// ---------------------------------------------------------------------------

function playBeep(type: "ok" | "error"): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = type === "ok" ? 880 : 220;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // AudioContext puede no estar disponible en SSR / jsdom.
  }
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function PickingStationPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}): React.ReactElement {
  const { orderId } = use(params);
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;

  // Cargar la receta para obtener los ítems.
  const prescriptionQuery = trpcAny.pharmacy.prescription.get.useQuery(
    { id: orderId },
    { retry: false },
  );

  const scanMutation = trpcAny.dispensation.scanItem.useMutation();

  // Estado local de ítems de picking (inicializado desde la receta).
  const [items, setItems] = React.useState<PickingItem[]>([]);
  const [hardStop, setHardStop] = React.useState<HardStopModal>({
    visible: false,
    reason: "",
  });

  // Inicializar ítems cuando la receta carga.
  React.useEffect(() => {
    if (!prescriptionQuery.data) return;
    const rx = prescriptionQuery.data;
    const rxItems = rx.items ?? [];
    setItems(
      rxItems.map(
        (it: {
          id: string;
          drug: { id: string; genericName: string };
          dosage: string;
          route: string;
          frequency: string;
        }) => ({
          id: it.id,
          drugId: it.drug.id,
          genericName: it.drug.genericName,
          dosage: it.dosage,
          route: it.route,
          frequency: it.frequency,
          status: "PENDIENTE" as ItemStatus,
        }),
      ),
    );
  }, [prescriptionQuery.data]);

  const allScanned =
    items.length > 0 && items.every((it) => it.status === "ESCANEADO");
  const pendingCount = items.filter((it) => it.status === "PENDIENTE").length;

  async function handleScanSuccess(gs1Raw: string, data: Gs1DataPartial) {
    try {
      if (!data.gtin) {
        playBeep("error");
        setHardStop({ visible: true, reason: "GS1_PARSE_ERROR: GTIN ausente en el DataMatrix." });
        return;
      }
      const result = await scanMutation.mutateAsync({
        pharmacyOrderId: orderId,
        gtin: data.gtin,
        ...(data.lot ? { lot: data.lot } : {}),
        ...(data.expiry ? { expiry: data.expiry } : {}),
        ...(data.serial ? { serial: data.serial } : {}),
        gs1Raw,
      });

      if ("hardStop" in result) {
        playBeep("error");
        setHardStop({ visible: true, reason: mapHardStop(result.hardStop as string) });
        // Marcar el primer ítem pendiente como HARD_STOP.
        setItems((prev) => {
          const idx = prev.findIndex((it) => it.status === "PENDIENTE");
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx]!,
            status: "HARD_STOP",
            hardStopReason: result.hardStop as string,
          };
          return next;
        });
        return;
      }

      // Scan correcto.
      playBeep("ok");
      const scanned = result.item as {
        prescriptionItemId: string;
        gtin: string;
        lot: string | null;
        expiry: string | null;
      };
      setItems((prev) => {
        const idx = prev.findIndex(
          (it) =>
            it.id === scanned.prescriptionItemId && it.status === "PENDIENTE",
        );
        const fallbackIdx = prev.findIndex((it) => it.status === "PENDIENTE");
        const target = idx !== -1 ? idx : fallbackIdx;
        if (target === -1) return prev;
        const next = [...prev];
        next[target] = {
          ...next[target]!,
          status: "ESCANEADO",
          scannedGtin: scanned.gtin,
          scannedLot: scanned.lot ?? undefined,
          scannedExpiry: scanned.expiry ?? undefined,
        };
        return next;
      });
    } catch (err: unknown) {
      playBeep("error");
      const msg = err instanceof Error ? err.message : "Error al validar el scan.";
      setHardStop({ visible: true, reason: msg });
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (prescriptionQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Cargando orden…</p>
      </div>
    );
  }

  if (prescriptionQuery.error || !prescriptionQuery.data) {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive">
        No se pudo cargar la orden o no existe.{" "}
        <button
          type="button"
          className="underline"
          onClick={() => router.back()}
        >
          Volver
        </button>
      </div>
    );
  }

  const rx = prescriptionQuery.data;

  return (
    <div className="space-y-6">
      {/* Hard Stop modal */}
      {hardStop.visible ? (
        <HardStopOverlay
          reason={hardStop.reason}
          onClose={() => setHardStop({ visible: false, reason: "" })}
        />
      ) : null}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Picking — Estación de Dispensación</h1>
        <p className="text-sm text-muted-foreground">
          Paciente: {rx.patient?.firstName} {rx.patient?.lastName} · MRN{" "}
          {rx.patient?.mrn}
        </p>
      </div>

      {/* Escáner GS1 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Escanear DataMatrix de la unidad
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Gs1Scanner
            onScanSuccess={(data) => {
              const gs1Raw = buildGs1Raw(data);
              void handleScanSuccess(gs1Raw, data);
            }}
            onScanError={(msg) => {
              playBeep("error");
              setHardStop({ visible: true, reason: `GS1_PARSE_ERROR: ${msg}` });
            }}
          />
          {scanMutation.isPending ? (
            <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
              Validando scan…
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Tabla de ítems */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Ítems de la receta{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({items.filter((it) => it.status === "ESCANEADO").length}/{items.length} escaneados)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-md border" role="list" aria-label="Ítems de la receta">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{item.genericName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.dosage} · {item.route} · {item.frequency}
                  </p>
                  {item.scannedGtin ? (
                    <p className="text-xs text-muted-foreground font-mono">
                      GTIN: {item.scannedGtin}
                      {item.scannedLot ? ` · Lote: ${item.scannedLot}` : ""}
                    </p>
                  ) : null}
                  {item.hardStopReason ? (
                    <p className="text-xs text-destructive" role="alert">
                      {mapHardStop(item.hardStopReason)}
                    </p>
                  ) : null}
                </div>
                <ItemStatusBadge status={item.status} />
              </li>
            ))}
            {items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                Cargando ítems…
              </li>
            ) : null}
          </ul>
        </CardContent>
      </Card>

      {/* Acciones */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Volver a la cola
        </Button>
        <Button
          type="button"
          disabled={!allScanned}
          aria-disabled={!allScanned}
          onClick={() => {
            // Fase 2: dispatch de la dispensación completa (US.F2.6.13+).
            // Por ahora navega a confirmación.
            router.push(`/pharmacy/dispense/${orderId}/confirm`);
          }}
        >
          Finalizar Dispensación
          {pendingCount > 0 ? ` (${pendingCount} pendiente${pendingCount !== 1 ? "s" : ""})` : ""}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function HardStopOverlay({
  reason,
  onClose,
}: {
  reason: string;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Hard Stop de Dispensación"
      aria-live="assertive"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-red-600 text-white p-8"
    >
      <h2 className="text-4xl font-bold mb-4">HARD STOP</h2>
      <p className="text-xl text-center max-w-lg mb-8">{reason}</p>
      <Button
        type="button"
        variant="outline"
        className="bg-white text-red-700 border-white hover:bg-red-50"
        onClick={onClose}
      >
        Cerrar y reintentar
      </Button>
    </div>
  );
}

function ItemStatusBadge({ status }: { status: ItemStatus }): React.ReactElement {
  if (status === "ESCANEADO") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-300">
        ESCANEADO
      </Badge>
    );
  }
  if (status === "HARD_STOP") {
    return (
      <Badge variant="destructive">
        HARD STOP
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      PENDIENTE
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapHardStop(code: string): string {
  const map: Record<string, string> = {
    GTIN_NO_COINCIDE_CON_RECETA: "El GTIN escaneado no corresponde a la receta médica activa.",
    MEDICAMENTO_VENCIDO: "Medicamento vencido. No se puede dispensar. Farmacéutico jefe notificado.",
    LOTE_EN_RECALL: "Lote en alerta de RECALL. Dispensación bloqueada automáticamente.",
  };
  return map[code] ?? code;
}

type Gs1DataPartial = {
  gtin?: string;
  lot?: string;
  expiry?: string;
  serial?: string;
};

/** Reconstruye un string GS1 AI desde los datos parseados para re-enviar al server. */
function buildGs1Raw(data: Gs1DataPartial): string {
  let s = "";
  if (data.gtin) s += `(01)${data.gtin}`;
  if (data.lot) s += `(10)${data.lot}`;
  if (data.expiry) s += `(17)${data.expiry}`;
  if (data.serial) s += `(21)${data.serial}`;
  return s;
}
