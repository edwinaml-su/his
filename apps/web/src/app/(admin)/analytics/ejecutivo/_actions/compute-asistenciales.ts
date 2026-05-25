"use server";

/**
 * Server action — calcula los 5 KPIs reales Asistenciales.
 *
 * KPIs:
 *   - asi_estancia              (días promedio de estancia)
 *   - asi_ocupacion_camas       (% camas ocupadas)
 *   - asi_reingreso_30d         (% reingresos en 30d)
 *   - asi_espera_urgencias      (min promedio espera triage)
 *   - asi_eventos_adversos      (eventos por 1000 pacientes)
 */
import { prisma } from "@his/database";
import type { KpiValue } from "../_components/kpi-card";
import type { Categoria } from "../_lib/kpi-catalog";
import { fmtUnidad, semaforoMenor, semaforoRango } from "../_lib/mock-values";

export interface ComputeRequest {
  organizationIds: string[];
  fechaDesde: string;
  fechaHasta: string;
}

export type KpiValuesMap = Record<string, KpiValue | null>;

export async function computeAsistenciales(req: ComputeRequest): Promise<KpiValuesMap> {
  void (("asistenciales" as Categoria)); // satisface el import de tipo sin lógica extra
  const result: KpiValuesMap = {};
  const desde = new Date(req.fechaDesde);
  const hasta = new Date(req.fechaHasta);
  const orgFilter = req.organizationIds.length > 0
    ? { organizationId: { in: req.organizationIds } }
    : {};

  // -------------------------------------------------------------------------
  // asi_estancia — promedio días entre admittedAt y dischargedAt (DISCHARGED)
  // Fuente: InpatientAdmission (status DISCHARGED, dischargedAt en periodo)
  // -------------------------------------------------------------------------
  try {
    const admissions = await prisma.inpatientAdmission.findMany({
      where: {
        ...orgFilter,
        status: "DISCHARGED",
        dischargedAt: { gte: desde, lte: hasta },
        deletedAt: null,
      },
      select: { admittedAt: true, dischargedAt: true },
    });

    if (admissions.length === 0) {
      result.asi_estancia = null;
    } else {
      const diasTotal = admissions.reduce((sum, a) => {
        const dias = (a.dischargedAt!.getTime() - a.admittedAt.getTime()) / 86_400_000;
        return sum + dias;
      }, 0);
      const promedio = diasTotal / admissions.length;
      result.asi_estancia = {
        display: fmtUnidad(promedio, "días"),
        semaforo: promedio <= 5 ? "verde" : promedio <= 10 ? "ambar" : "rojo",
        delta: `${admissions.length} egresos`,
      };
    }
  } catch {
    result.asi_estancia = null;
  }

  // -------------------------------------------------------------------------
  // asi_ocupacion_camas — camas OCCUPIED vs activas totales
  // Fuente: Bed (active=true) + BedAssignment sin releasedAt (ocupación actual)
  // Nota: usamos status=OCCUPIED en Bed para snapshot instantáneo (más eficiente
  //       que cruzar BedAssignment activos, que requiere subconsulta compleja).
  // -------------------------------------------------------------------------
  try {
    const [totalCamas, camasOcupadas] = await Promise.all([
      prisma.bed.count({
        where: { ...orgFilter, active: true },
      }),
      prisma.bed.count({
        where: { ...orgFilter, active: true, status: "OCCUPIED" },
      }),
    ]);

    if (totalCamas === 0) {
      result.asi_ocupacion_camas = null;
    } else {
      const pct = (camasOcupadas / totalCamas) * 100;
      result.asi_ocupacion_camas = {
        display: fmtUnidad(pct, "%"),
        semaforo: semaforoRango(pct, 75, 85),
        delta: `${camasOcupadas}/${totalCamas} camas`,
      };
    }
  } catch {
    result.asi_ocupacion_camas = null;
  }

  // -------------------------------------------------------------------------
  // asi_reingreso_30d — pacientes con 2+ admisiones, la segunda ≤ 30d del alta
  // Fuente: InpatientAdmission discharged en periodo + lookforward 30d por patientId
  // -------------------------------------------------------------------------
  try {
    const egresos = await prisma.inpatientAdmission.findMany({
      where: {
        ...orgFilter,
        status: "DISCHARGED",
        dischargedAt: { gte: desde, lte: hasta },
        deletedAt: null,
      },
      select: { patientId: true, dischargedAt: true },
    });

    if (egresos.length === 0) {
      result.asi_reingreso_30d = null;
    } else {
      // Para cada egreso, verificar si hay otro ingreso del mismo paciente ≤30d después
      const TREINTA_DIAS_MS = 30 * 86_400_000;
      let reingresos = 0;

      // Agrupar por patientId para evitar N+1 (un solo query de validación por paciente único)
      const egresosPorPaciente = new Map<string, Date[]>();
      for (const e of egresos) {
        const lista = egresosPorPaciente.get(e.patientId) ?? [];
        lista.push(e.dischargedAt!);
        egresosPorPaciente.set(e.patientId, lista);
      }

      const pacientesUnicos = Array.from(egresosPorPaciente.keys());

      // Traer todas las admisiones de esos pacientes en la ventana extendida (hasta + 30d)
      const ventanaFin = new Date(hasta.getTime() + TREINTA_DIAS_MS);
      const reingresoRows = await prisma.inpatientAdmission.findMany({
        where: {
          ...orgFilter,
          patientId: { in: pacientesUnicos },
          admittedAt: { gt: desde, lte: ventanaFin },
          deletedAt: null,
        },
        select: { patientId: true, admittedAt: true },
      });

      // Comparar: un reingreso cuenta si hay una admisión dentro de 30d de algún alta
      for (const reingreso of reingresoRows) {
        const altas = egresosPorPaciente.get(reingreso.patientId) ?? [];
        const esReingreso = altas.some(
          (alta) =>
            reingreso.admittedAt.getTime() > alta.getTime() &&
            reingreso.admittedAt.getTime() - alta.getTime() <= TREINTA_DIAS_MS,
        );
        if (esReingreso) reingresos++;
      }

      const pct = (reingresos / egresos.length) * 100;
      result.asi_reingreso_30d = {
        display: fmtUnidad(pct, "%"),
        semaforo: semaforoMenor(pct, 5),
        delta: `${reingresos} de ${egresos.length} egresos`,
      };
    }
  } catch {
    result.asi_reingreso_30d = null;
  }

  // -------------------------------------------------------------------------
  // asi_espera_urgencias — tiempo entre EmergencyVisit.arrivedAt y
  //   TriageEvaluation.completedAt (el triage es el primer contacto clínico)
  // Fuente: EmergencyVisit + triageEvaluation (JOIN via triageEvaluationId)
  // -------------------------------------------------------------------------
  try {
    const visitas = await prisma.emergencyVisit.findMany({
      where: {
        ...orgFilter,
        arrivedAt: { gte: desde, lte: hasta },
        deletedAt: null,
        triageEvaluationId: { not: null },
      },
      select: {
        arrivedAt: true,
        triageEvaluation: {
          select: { completedAt: true },
        },
      },
    });

    const conTriage = visitas.filter((v) => v.triageEvaluation?.completedAt != null);

    if (conTriage.length === 0) {
      result.asi_espera_urgencias = null;
    } else {
      const sumaMinutos = conTriage.reduce((sum, v) => {
        const espera =
          (v.triageEvaluation!.completedAt!.getTime() - v.arrivedAt.getTime()) / 60_000;
        // Descartar valores negativos o absurdamente grandes (datos corruptos)
        return espera > 0 && espera < 480 ? sum + espera : sum;
      }, 0);
      const promedio = sumaMinutos / conTriage.length;
      result.asi_espera_urgencias = {
        display: fmtUnidad(promedio, "minutos"),
        semaforo: semaforoMenor(promedio, 15),
        delta: `${conTriage.length} visitas`,
      };
    }
  } catch {
    result.asi_espera_urgencias = null;
  }

  // -------------------------------------------------------------------------
  // asi_eventos_adversos — no existe modelo FallEvent ni AdverseEvent en BD.
  // Proxy: MedicationAdministration con status=CANCELED y cancelReason no null,
  //        que captura errores de medicación reportados.
  // NOTA: Este proxy es parcial (solo errores medicación, no caídas ni úlceras).
  //       Se devuelve null hasta que exista un módulo de seguridad del paciente.
  // -------------------------------------------------------------------------
  result.asi_eventos_adversos = null;

  return result;
}
