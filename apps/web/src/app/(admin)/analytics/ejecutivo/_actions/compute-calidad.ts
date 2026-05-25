"use server";

/**
 * Server action — calcula los 3 KPIs reales de Calidad de Datos.
 *
 * KPIs:
 *   - dat_completos          (% registros con campos críticos completos)
 *   - dat_duplicidad_mpi     (% pacientes duplicados detectados por MPI)
 *   - dat_codificacion       (% diagnósticos correctamente codificados CIE-10)
 */
import { prisma } from "@his/database";
import type { KpiValue } from "../_components/kpi-card";
import { semaforoMayor, semaforoMenor, fmtUnidad } from "../_lib/mock-values";

export interface ComputeRequest {
  organizationIds: string[];
  fechaDesde: string;
  fechaHasta: string;
}

export type KpiValuesMap = Record<string, KpiValue | null>;

export async function computeCalidad(req: ComputeRequest): Promise<KpiValuesMap> {
  const result: KpiValuesMap = {};
  const orgFilter =
    req.organizationIds.length > 0
      ? { organizationId: { in: req.organizationIds } }
      : {};

  // -- dat_completos --------------------------------------------------------
  // Campos críticos del modelo Patient: birthDate, biologicalSexId, mrn.
  // biologicalSexId y mrn son NOT NULL en schema; birthDate es nullable.
  // Medimos: pacientes sin birthDate como "incompletos".
  try {
    const [total, incompletos] = await Promise.all([
      prisma.patient.count({ where: { ...orgFilter, deletedAt: null } }),
      prisma.patient.count({
        where: { ...orgFilter, deletedAt: null, birthDate: null },
      }),
    ]);
    if (total === 0) {
      result.dat_completos = null;
    } else {
      const completos = total - incompletos;
      const v = (completos / total) * 100;
      result.dat_completos = {
        display: fmtUnidad(v, "%"),
        semaforo: semaforoMayor(v, 98, 90),
      };
    }
  } catch {
    result.dat_completos = null;
  }

  // -- dat_duplicidad_mpi ---------------------------------------------------
  // PatientMerge: cada fila representa un paciente absorbido (duplicado detectado).
  // Total = pacientes activos (mergedIntoId === null, deletedAt === null).
  try {
    const [totalActivos, duplicados] = await Promise.all([
      prisma.patient.count({
        where: { ...orgFilter, deletedAt: null, mergedIntoId: null },
      }),
      prisma.patientMerge.count({
        where:
          req.organizationIds.length > 0
            ? { from: { organizationId: { in: req.organizationIds } } }
            : {},
      }),
    ]);
    if (totalActivos === 0) {
      result.dat_duplicidad_mpi = null;
    } else {
      const v = (duplicados / totalActivos) * 100;
      result.dat_duplicidad_mpi = {
        display: fmtUnidad(v, "%"),
        // menos es mejor: meta ≤ 1%, crítico > 3%
        semaforo: semaforoMenor(v, 1, 3),
      };
    }
  } catch {
    result.dat_duplicidad_mpi = null;
  }

  // -- dat_codificacion -----------------------------------------------------
  // EncounterDiagnosis → ClinicalConcept.code debe cumplir formato CIE-10.
  // Prisma no soporta filtro regex nativo; usamos $queryRaw con SIMILAR TO.
  // Filtramos por diagnosedAt en el rango de fechas del request.
  try {
    const desde = new Date(req.fechaDesde);
    const hasta = new Date(req.fechaHasta);

    type CountRow = { count: bigint };

    if (req.organizationIds.length > 0) {
      const [totalRows, validosRows] = await Promise.all([
        prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "EncounterDiagnosis" ed
          JOIN "Encounter" e ON e.id = ed."encounterId"
          WHERE e."organizationId" = ANY(${req.organizationIds}::uuid[])
            AND ed."diagnosedAt" BETWEEN ${desde} AND ${hasta}
        `,
        prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "EncounterDiagnosis" ed
          JOIN "Encounter" e ON e.id = ed."encounterId"
          JOIN "ClinicalConcept" cc ON cc.id = ed."conceptId"
          WHERE e."organizationId" = ANY(${req.organizationIds}::uuid[])
            AND ed."diagnosedAt" BETWEEN ${desde} AND ${hasta}
            AND cc.code SIMILAR TO '[A-Z][0-9]{2}(\.[0-9]{1,2})?'
        `,
      ]);
      const total = Number(totalRows[0]?.count ?? 0);
      const validos = Number(validosRows[0]?.count ?? 0);
      if (total === 0) {
        result.dat_codificacion = null;
      } else {
        const v = (validos / total) * 100;
        result.dat_codificacion = {
          display: fmtUnidad(v, "%"),
          semaforo: semaforoMayor(v, 97, 90),
        };
      }
    } else {
      const [totalRows, validosRows] = await Promise.all([
        prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "EncounterDiagnosis"
          WHERE "diagnosedAt" BETWEEN ${desde} AND ${hasta}
        `,
        prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "EncounterDiagnosis" ed
          JOIN "ClinicalConcept" cc ON cc.id = ed."conceptId"
          WHERE ed."diagnosedAt" BETWEEN ${desde} AND ${hasta}
            AND cc.code SIMILAR TO '[A-Z][0-9]{2}(\.[0-9]{1,2})?'
        `,
      ]);
      const total = Number(totalRows[0]?.count ?? 0);
      const validos = Number(validosRows[0]?.count ?? 0);
      if (total === 0) {
        result.dat_codificacion = null;
      } else {
        const v = (validos / total) * 100;
        result.dat_codificacion = {
          display: fmtUnidad(v, "%"),
          semaforo: semaforoMayor(v, 97, 90),
        };
      }
    }
  } catch {
    result.dat_codificacion = null;
  }

  return result;
}
