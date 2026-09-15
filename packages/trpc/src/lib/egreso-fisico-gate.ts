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
 *     administrativa que gatee la liberación FÍSICA de la cama (por
 *     salubridad/rotación, la cama se libera de inmediato). Esto NO exime
 *     el cierre ADMINISTRATIVO de la cuenta: `death-certificate.router.ts`
 *     cierra `Encounter` con `dischargedAt` seteado (sin importar
 *     `dischargeType`), que es exactamente la precondición de Fase 1 que
 *     `patientAccount.altaAdministrativa` exige (`encounter.dischargedAt`
 *     no nulo) — por eso una cuenta abierta al momento de una defunción
 *     SIGUE pudiendo (y debiendo) cerrarse vía la misma ruta CANCELACION_
 *     TOTAL/CXC de siempre; su paso de liberación de cama ahí es no-op
 *     porque ya se liberó antes. C5 auditoría (2026-09-15) confirmó esta
 *     coherencia — no hay una causa "DEFUNCION" separada en
 *     `altaAdministrativa` porque no hace falta una: la ruta administrativa
 *     ya funciona post-óbito sin cambios. Gap real (P1, fuera de CC-0034):
 *     nada dispara/recuerda ese cierre — queda a criterio operativo de
 *     Cobros, sin alerta automática (ver hallazgo de notificaciones
 *     "Defunción con cuenta abierta" en el audit 2026-09-15).
 *   - traslado interno de cama (`encounter-transfer.router.ts`) — el
 *     paciente sigue dentro del establecimiento, no es un egreso.
 *
 * `dischargeEncounter` (Fase 1, `encounter-discharge.router.ts`) usa
 * `hasCuentaActiva` directamente (no `assertEgresoFisicoAutorizado`): en vez
 * de fallar el alta médica, DIFIERE la liberación de la cama hasta que
 * `altaAdministrativa` la libere.
 *
 * `inpatient.router.ts` (`admission.discharge` / `admission.transferOut`,
 * C5 auditoría P0-3, 2026-09-15) — ruta paralela/legacy que libera la MISMA
 * cama (`public.Bed`, vía `BedAssignment.encounterId`) que `bed.router.ts:
 * release`, pero antes NO invocaba este gate en absoluto (bypass total).
 * Ambas transiciones (`DISCHARGED` y `TRANSFERRED_OUT`, esta última un
 * egreso a otra organización — no un traslado interno) ahora llaman
 * `assertEgresoFisicoAutorizado` antes de liberar la cama, igual que
 * `bed.router.ts:release`.
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
