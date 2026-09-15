/**
 * quirofano-reserva-cargo.ts — C5 auditoría P0-4 (docs/audit/2026-09-15_cobertura/
 * 01-admision-emergencia-hosp-quirofano.md).
 *
 * docs/48 §5 C3-2 (decisión Edwin 2026-09-12): el disparador del cargo de
 * quirófano es la RESERVA de sala, no el acto quirúrgico. Ese cargo solo se
 * generaba en la vía legacy (`surgery.router.ts` case.create, que lee
 * `OperatingRoom.chargeCode`) — la vía "oficial" NTEC
 * (`ece/bridge-cirugia.router.ts` programarCirugia, sobre
 * `ece.reserva_sala_qx`) nunca la invocaba: toda reserva hecha por ese
 * camino quedaba sin facturar (fuga de ingreso).
 *
 * Este helper es el ÚNICO punto de captura del cargo `USO_INSTALACIONES` de
 * reserva de quirófano — reutiliza `capturarCargo`/`resolverPrecio` (mismo
 * mecanismo que ya usa `surgery.router.ts`) y se invoca desde AMBAS vías,
 * dentro de la transacción de cada una.
 */
import type { PrismaClient } from "@prisma/client";
import { capturarCargo, type CapturarCargoResult } from "./charge-capture";

export interface CapturarCargoReservaQuirofanoParams {
  organizationId: string;
  /** `public.Patient.id` — el paciente dueño de la cuenta a cargar. */
  patientId: string;
  /** Si la reserva vive dentro de un encuentro HIS activo, pásalo para anclar el cargo a esa cuenta. */
  encounterId?: string | null;
  descripcionProcedimiento: string;
  /** `OperatingRoom.chargeCode` — null si la vía no tiene ese vínculo (bridge NTEC). */
  chargeCode: string | null;
  /** Código legible de la sala (`OperatingRoom.code` o `ece.sala_qx.codigo`) — usado en el sintético `QX-<code>` cuando no hay `chargeCode` (R3: nunca cargo en 0, nunca silencio). */
  codigoSalaFallback: string;
  /** `SurgeryCase.id` o `EceReservaSalaQx.id` — identifica la reserva para idempotencia y reversión. */
  referenciaId: string;
  actorId: string;
}

/** Estados de `PatientAccountService` que cuentan como "ya capturado" para esta reserva. */
const ESTADOS_CARGO_VIGENTE = ["VIGENTE", "PENDIENTE_TARIFA"] as const;

/**
 * Captura el cargo `USO_INSTALACIONES` de una reserva de quirófano. Debe
 * llamarse DENTRO de la transacción que crea/confirma la reserva (mismo
 * `tx`), en cualquiera de las dos vías.
 *
 * Idempotente por `referenciaId`: si la reserva ya tiene un cargo
 * VIGENTE o PENDIENTE_TARIFA con ese `origen`, lo retorna sin duplicar.
 */
export async function capturarCargoReservaQuirofano(
  tx: PrismaClient,
  params: CapturarCargoReservaQuirofanoParams,
): Promise<CapturarCargoResult> {
  const existente = await tx.patientAccountService.findFirst({
    where: {
      referenciaId: params.referenciaId,
      origen: "USO_INSTALACIONES",
      status: { in: [...ESTADOS_CARGO_VIGENTE] },
      // Defensa en profundidad — mismo filtro que la reversión de cargo en
      // bridge-cirugia.router.ts (Paso 1b). referenciaId es un UUIDv4 (no
      // explotable en la práctica), pero no hay razón para NO acotar por
      // organización cuando el dato ya está disponible.
      account: { organizationId: params.organizationId },
    },
    select: { id: true, status: true, unitPrice: true },
  });
  if (existente) {
    return {
      cargoId: existente.id,
      status: existente.status as CapturarCargoResult["status"],
      unitPrice: existente.unitPrice == null ? null : Number(existente.unitPrice),
    };
  }

  const code = params.chargeCode ?? `QX-${params.codigoSalaFallback}`;
  return capturarCargo(tx, {
    organizationId: params.organizationId,
    patientId: params.patientId,
    encounterId: params.encounterId ?? null,
    code,
    descripcion: `Reserva de quirófano — ${params.descripcionProcedimiento}`,
    quantity: 1,
    origen: "USO_INSTALACIONES",
    referenciaId: params.referenciaId,
    actorId: params.actorId,
  });
}
