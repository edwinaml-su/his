"use client";

/**
 * US.F2.6.19 / US.F2.6.6 — Lista de órdenes pendientes de dispensación.
 *
 * Muestra recetas SIGNED / PARTIALLY_DISPENSED con filtros de turno y estado.
 * "Iniciar Dispensación" verifica pre-condiciones (US.F2.6.6) antes de navegar
 * al flujo de picking por orden ([orderId]).
 *
 * NOTA: Este archivo extiende (no reemplaza) el flujo legacy de despacho de
 * medicamentos — agrega la capa GS1 picking por encima.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";
import {
  PrescriptionStatusBadge,
  type PrescriptionStatus,
} from "../_components/prescription-status-badge";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

interface PrescriptionListItem {
  id: string;
  status: PrescriptionStatus;
  prescribedAt: string | Date;
  prescriberId: string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
  };
  encounter: { id: string; encounterNumber: string };
  items: Array<{
    id: string;
    drug: { genericName: string };
    dosage: string;
    frequency: string;
  }>;
}

const ELIGIBLE_STATUSES: PrescriptionStatus[] = ["SIGNED", "PARTIALLY_DISPENSED"];

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function PharmacyPickingQueuePage(): React.ReactElement {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const list = trpcAny.pharmacy.prescription.list.useQuery({});

  const [startingId, setStartingId] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const checkPreconditions =
    trpcAny.dispensation.checkPreconditions.useQuery as (
      args: { patientId: string; indicationId: string },
      opts: { enabled: boolean; retry: false },
    ) => { isLoading: boolean; error: { message: string } | null; data: unknown };

  const all = (list.data?.items ?? list.data ?? []) as PrescriptionListItem[];
  const queue = all.filter((rx) => ELIGIBLE_STATUSES.includes(rx.status));

  async function handleStartPicking(rx: PrescriptionListItem) {
    setErrorMsg(null);
    setStartingId(rx.id);
    try {
      // Verificar pre-condición server-side antes de navegar.
      await trpcAny.dispensation.checkPreconditions.fetch({
        patientId: rx.patient.id,
        indicationId: rx.id,
      });
      router.push(`/pharmacy/dispense/${rx.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al verificar la receta.";
      setErrorMsg(mapHardStop(msg));
    } finally {
      setStartingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Estación de Picking — Cola de Dispensación</h1>
        <p className="text-sm text-muted-foreground">
          Recetas firmadas pendientes de dispensar con escaneo GS1 DataMatrix.
        </p>
      </div>

      {errorMsg ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {errorMsg}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            Cola de órdenes{" "}
            {queue.length > 0 ? (
              <Badge variant="secondary">{queue.length}</Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando órdenes…</p>
          ) : queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay órdenes pendientes de dispensar.
            </p>
          ) : (
            <ul className="divide-y rounded-md border" role="list">
              {queue.map((rx) => (
                <li
                  key={rx.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <div className="space-y-0.5">
                    <p className="font-semibold">
                      {rx.patient.firstName} {rx.patient.lastName}
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        MRN {rx.patient.mrn} · {rx.encounter.encounterNumber}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(rx.prescribedAt).toLocaleString("es-SV")} ·{" "}
                      {rx.items.length} ítem{rx.items.length !== 1 ? "s" : ""}
                      {" · "}
                      {rx.items
                        .slice(0, 2)
                        .map((it) => it.drug.genericName)
                        .join(", ")}
                      {rx.items.length > 2 ? "…" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <PrescriptionStatusBadge status={rx.status} />
                    <Button
                      type="button"
                      size="sm"
                      disabled={startingId === rx.id}
                      onClick={() => handleStartPicking(rx)}
                      aria-label={`Iniciar dispensación para ${rx.patient.firstName} ${rx.patient.lastName}`}
                    >
                      {startingId === rx.id ? "Verificando…" : "Iniciar Dispensación"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapHardStop(raw: string): string {
  if (raw.includes("SIN_RECETA_ACTIVA")) {
    return "Hard Stop: No existe receta médica digital activa para este paciente.";
  }
  if (raw.includes("RECETA_SUSPENDIDA")) {
    return "Hard Stop: La receta está suspendida. Verifique con el médico prescriptor.";
  }
  return raw;
}
