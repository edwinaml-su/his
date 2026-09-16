/**
 * CC-0036 Ola 4 (REQ-HIS-AFIL-001 US.AGE.2.4 AC5) — estimado informativo de
 * precio + cobertura al reservar una cita. NO genera cargo (el cargo real
 * nace en el check-in/atención, fuera de este helper).
 *
 * Supuesto documentado (REQ no fija el código de tarifario de la consulta
 * externa genérica): se usa el código `CONSULTA_EXTERNA` contra la lista de
 * precios de `TipoCuenta` (o la lista DEFAULT de la org si el tipo de cuenta
 * no tiene lista o no fue provisto). Si el código no resuelve en ningún
 * catálogo, el estimado vuelve `null` con una advertencia — la reserva NUNCA
 * se bloquea por esto (es informativo, AC5).
 */
import type { PrismaClient } from "@his/database";
import { resolverPrecioEnLista, resolverDefaultPriceListId } from "./price-resolver";
import { resolverCobertura } from "./coverage-resolver";

/** Código de tarifario asumido para consulta externa genérica (ver docstring). */
export const CODIGO_CONSULTA_EXTERNA = "CONSULTA_EXTERNA";

export interface EstimadoConsulta {
  precio: number | null;
  moneda: string | null;
  totalPaciente: number | null;
  totalAsegurado: number | null;
  advertencias: string[];
}

export async function estimarConsulta(
  tx: PrismaClient,
  params: {
    organizationId: string;
    patientId: string;
    tipoCuentaId?: string | null;
    fecha: Date;
  },
): Promise<EstimadoConsulta> {
  const advertencias: string[] = [];

  try {
    const org = await tx.organization.findUnique({
      where: { id: params.organizationId },
      select: { functionalCurrency: true },
    });

    let priceListId: string | null = null;
    if (params.tipoCuentaId) {
      const tipo = await tx.tipoCuenta.findFirst({
        where: { id: params.tipoCuentaId, organizationId: params.organizationId },
        select: { priceListId: true },
      });
      priceListId = tipo?.priceListId ?? null;
    }
    if (!priceListId) {
      priceListId = await resolverDefaultPriceListId(tx, params.organizationId);
    }

    if (!priceListId) {
      advertencias.push("Sin lista de precios configurada para estimar la consulta.");
      return { precio: null, moneda: org?.functionalCurrency ?? null, totalPaciente: null, totalAsegurado: null, advertencias };
    }

    const precioResuelto = await resolverPrecioEnLista(tx, {
      organizationId: params.organizationId,
      priceListId,
      code: CODIGO_CONSULTA_EXTERNA,
      fecha: params.fecha,
    });

    if (precioResuelto.precio == null) {
      advertencias.push(`Sin tarifa configurada para el código "${CODIGO_CONSULTA_EXTERNA}".`);
      return { precio: null, moneda: org?.functionalCurrency ?? null, totalPaciente: null, totalAsegurado: null, advertencias };
    }

    const cobertura = await resolverCobertura(tx, {
      organizationId: params.organizationId,
      patientId: params.patientId,
      fecha: params.fecha,
      lineas: [{ code: CODIGO_CONSULTA_EXTERNA, ambito: "CONSULTA", total: precioResuelto.precio }],
    });

    return {
      precio: precioResuelto.precio,
      moneda: org?.functionalCurrency ?? null,
      totalPaciente: cobertura.totalPaciente,
      totalAsegurado: cobertura.totalAsegurado,
      advertencias,
    };
  } catch (err) {
    // Informativo — un fallo de resolución nunca bloquea la reserva (AC5).
    console.error("[cita-estimado] estimarConsulta falló, se omite el estimado", err);
    return { precio: null, moneda: null, totalPaciente: null, totalAsegurado: null, advertencias: ["No se pudo calcular el estimado."] };
  }
}
