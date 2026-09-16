/**
 * CC-0036 Ola 5 (Decisión Edwin Martinez 2026-09-16 #2c) — agregado por
 * RUBRO (centro de costo + cuenta contable) de los cargos de una cuenta,
 * rumbo al ERP. Extraído a lib compartida (hallazgo #4 de la revisión
 * pre-PR): antes solo vivía como query en `honorario.router.ts`
 * (`resumenPorRubro`) sin que nada la invocara al cerrar la cuenta —
 * `patientAccount.cerrar` (patient-account.router.ts) la usa ahora para
 * emitir `cuenta.resumen_rubros` tras el cierre.
 *
 * Precisión completa SOLO en cargos `HONORARIO_MEDICO` (vía
 * `ReglaHonorario.costCenterId`/`cuentaContableCodigo`, resuelto con JOIN a
 * `ProduccionMedica`). Los demás orígenes (farmacia/lab/imágenes/etc.) se
 * agregan por `origen` con `costCenterId` best-effort desde
 * `Encounter.costCenterId` y `cuentaContableCodigo=null` — GAP documentado:
 * no existe todavía un catálogo de mapeo `origen -> cuenta contable`
 * general (fuera de alcance de Ola 5; TODO de una ola de integración
 * contable).
 */
import type { PrismaClient } from "@prisma/client";

export interface RubroAgregado {
  origen: string;
  costCenterId: string | null;
  cuentaContableCodigo: string | null;
  total: number;
}

/** Prisma serializa Decimal como `{toNumber()}`; los mocks de test a veces pasan el number crudo. */
function decimalToNumber(v: { toNumber: () => number } | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

/**
 * Calcula el agregado por rubro de una cuenta. Debe llamarse DENTRO de una
 * transacción con contexto de tenant aplicado (withTenantContext).
 */
export async function calcularResumenRubros(
  tx: PrismaClient,
  params: { organizationId: string; accountId: string },
): Promise<RubroAgregado[]> {
  const cuenta = await tx.patientAccount.findFirst({
    where: { id: params.accountId, organizationId: params.organizationId },
    select: { id: true, encounter: { select: { costCenterId: true } } },
  });
  if (!cuenta) return [];

  const cargos = await tx.patientAccountService.findMany({
    where: { accountId: cuenta.id, status: { in: ["VIGENTE", "REVERSION"] } },
    select: { id: true, origen: true, totalPrice: true },
  });

  const produccionPorCargo = new Map<string, { costCenterId: string | null; cuentaContableCodigo: string | null }>();
  const honorarioCargoIds = cargos.filter((c) => c.origen === "HONORARIO_MEDICO").map((c) => c.id);
  if (honorarioCargoIds.length > 0) {
    const producciones = await tx.produccionMedica.findMany({
      where: { cargoHonorarioId: { in: honorarioCargoIds } },
      select: { cargoHonorarioId: true, reglaHonorario: { select: { costCenterId: true, cuentaContableCodigo: true } } },
    });
    for (const p of producciones) {
      if (p.cargoHonorarioId) {
        produccionPorCargo.set(p.cargoHonorarioId, {
          costCenterId: p.reglaHonorario?.costCenterId ?? null,
          cuentaContableCodigo: p.reglaHonorario?.cuentaContableCodigo ?? null,
        });
      }
    }
  }

  const rubros = new Map<string, RubroAgregado>();
  for (const cargo of cargos) {
    const origen = cargo.origen ?? "OTRO";
    const rubroHonorario = produccionPorCargo.get(cargo.id);
    const costCenterId = rubroHonorario?.costCenterId ?? cuenta.encounter?.costCenterId ?? null;
    const cuentaContableCodigo = rubroHonorario?.cuentaContableCodigo ?? null;
    const key = `${origen}::${costCenterId ?? ""}::${cuentaContableCodigo ?? ""}`;
    const acumulado = rubros.get(key) ?? { origen, costCenterId, cuentaContableCodigo, total: 0 };
    acumulado.total += decimalToNumber(cargo.totalPrice);
    rubros.set(key, acumulado);
  }

  return Array.from(rubros.values());
}
