/**
 * egreso-fisico-gate.ts — CC-0027 (Alta hospitalaria en dos fases).
 *
 * El egreso físico (liberación de cama) de un encuentro con una
 * `PatientAccount` activa (status != CERRADA) exige que la Fase 2 (alta
 * administrativa) haya concluido — `Encounter.egresoAutorizadoAt` seteado
 * por `patientAccount.altaAdministrativa`. Sin eso, un paciente con saldo
 * sin conciliar podría "salir" administrativamente (cama libre) sin que la
 * cuenta se haya cerrado.
 *
 * Excepciones — NO pasan por este helper, siguen su propio release inline
 * (documentado en el código de cada router, no aquí):
 *   - defunción (`death-certificate.router.ts`) — el óbito no tiene alta
 *     administrativa que gatee.
 *   - traslado interno de cama (`encounter-transfer.router.ts`) — el
 *     paciente sigue dentro del establecimiento, no es un egreso.
 *
 * `dischargeEncounter` (Fase 1, `encounter-discharge.router.ts`) usa
 * `hasCuentaActiva` directamente (no `assertEgresoFisicoAutorizado`): en vez
 * de fallar el alta médica, DIFIERE la liberación de la cama hasta que
 * `altaAdministrativa` la libere.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

/** true si el encuentro tiene una PatientAccount NO CERRADA vinculada. */
export async function hasCuentaActiva(
  tx: PrismaClient,
  params: { organizationId: string; encounterId: string },
): Promise<boolean> {
  const cuenta = await tx.patientAccount.findFirst({
    where: {
      encounterId: params.encounterId,
      organizationId: params.organizationId,
      status: { not: "CERRADA" },
    },
    select: { id: true },
  });
  return cuenta !== null;
}

/**
 * Lanza PRECONDITION_FAILED si el encuentro tiene cuenta activa sin alta
 * administrativa concluida. No-op si el encuentro ya tiene
 * `egresoAutorizadoAt` o no tiene ninguna cuenta activa vinculada.
 */
export async function assertEgresoFisicoAutorizado(
  tx: PrismaClient,
  params: { organizationId: string; encounterId: string },
): Promise<void> {
  const encounter = await tx.encounter.findFirst({
    where: { id: params.encounterId, organizationId: params.organizationId },
    select: { egresoAutorizadoAt: true },
  });
  if (encounter?.egresoAutorizadoAt) return;
  if (!(await hasCuentaActiva(tx, params))) return;

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Alta administrativa pendiente: no se puede liberar la cama hasta concluir la conciliación financiera (CC-0027).",
  });
}
