/**
 * gs1-patient-trace.router.ts — Consulta de trazabilidad EPCIS de movimiento
 * de paciente (admisión/traslado/alta).
 *
 * Lee `ece.gs1_epcis_patient_event` (ADR 0019 D5, sql/199_epcis_patient_movement.sql)
 * — tabla derivada, purgable/anonimizable, SEPARADA de `ece.gs1_epcis_event`
 * (farmacia). NO reutiliza `epcisQueryRouter` (equipos): el criterio de acceso y
 * el shape de columnas son distintos — ver ADR 0019, Contexto.
 *
 * Control de acceso (ADR 0019 privacidad punto 4 / dictamen @AE §3.4, restricción 5):
 * la misma población que hoy accede al episodio/expediente del paciente —
 * `tenantProcedure`, SIN rol nuevo. La RLS de `ece.gs1_epcis_patient_event`
 * (`establecimiento_id = ece.current_establecimiento_id_safe()`) exige el GUC ECE
 * (`withEceContext`, NO `withTenantContext` — namespaces de GUC distintos, ver
 * packages/trpc/src/ece/rls-context.ts).
 *
 * Auditoría (ADR 0019 D7 / dictamen restricción 9): consultar el recorrido
 * histórico completo de ubicación de un paciente es sensibilidad equivalente a
 * exportar el expediente — genera su propio AuditLog (action='READ',
 * entity='PatientLocationTrace'), patrón ya usado en encounter-discharge.router.ts
 * (entity='Encounter.epicrisis').
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../trpc";
import { withEceContext } from "../ece/rls-context";
import { resolveEceEstablecimientoId } from "../lib/ece-hooks";

const historyInput = z.object({
  patientId: z.string().uuid(),
});

interface PatientMovementEventRow {
  id: string;
  subtipo: string;
  what: unknown;
  where_data: unknown;
  event_time: Date;
  why: unknown;
  who: unknown;
  status: string;
}

export const gs1PatientTraceRouter = router({
  /**
   * Recorrido histórico completo de ubicación de un paciente (todos los
   * eventos PATIENT_ADMISSION/PATIENT_TRANSFER_DEPARTURE/
   * PATIENT_TRANSFER_ARRIVAL/PATIENT_DISCHARGE, orden cronológico).
   *
   * Registra su propio AuditLog por ser equivalente en sensibilidad a
   * exportar el expediente (dictamen @AE §4 restricción 9) — distinto de una
   * consulta operativa de "ubicación actual" (no implementada en este
   * router, ver ADR 0019 D7).
   */
  history: tenantProcedure.input(historyInput).query(async ({ ctx, input }) => {
    // resolveEceEstablecimientoId corre bajo el rol ambiente (BYPASSRLS) porque
    // ece.establecimiento tiene su propia RLS que aún no está seteada — mismo
    // patrón que encounter.router.ts / encounter-transfer.router.ts.
    if (!ctx.tenant.establishmentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Selecciona un establecimiento activo para consultar trazabilidad.",
      });
    }
    const eceEstablecimientoId = await resolveEceEstablecimientoId(
      ctx.prisma,
      ctx.tenant.establishmentId,
    );
    if (!eceEstablecimientoId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "ECE no inicializado para este establecimiento.",
      });
    }

    const patient = await ctx.prisma.patient.findFirst({
      where: {
        id: input.patientId,
        organizationId: ctx.tenant.organizationId,
        deletedAt: null,
      },
      select: { id: true, gsrn: true },
    });
    if (!patient) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
    }
    if (!patient.gsrn) {
      return { patientId: patient.id, gsrn: null, events: [] as PatientMovementEventRow[] };
    }

    const events = await withEceContext(
      ctx.prisma,
      ctx.user.id,
      eceEstablecimientoId,
      (tx) =>
        (
          tx as unknown as {
            $queryRawUnsafe: (q: string, ...v: unknown[]) => Promise<PatientMovementEventRow[]>;
          }
        ).$queryRawUnsafe(
          `SELECT id, subtipo, what, where_data, event_time, why, who, status
             FROM ece.gs1_epcis_patient_event
            WHERE what->>'gsrn' = $1
              AND status <> 'SUPPRESSED'
            ORDER BY event_time ASC`,
          patient.gsrn,
        ),
    );

    // Evento de auditoría propio — consulta de sensibilidad equivalente a
    // exportar el expediente (dictamen @AE §4 restricción 9). Se escribe
    // FUERA de withEceContext: audit."AuditLog" solo otorga INSERT al rol
    // ambiente (BYPASSRLS) — `authenticated` únicamente tiene SELECT (SQL
    // 06_rls_auth_audit.sql, verificado contra prod) porque la escritura
    // normal de esta tabla es vía trigger fn_audit_row(); un INSERT directo
    // bajo rol demotado fallaría con "permission denied".
    await ctx.prisma.auditLog.create({
      data: {
        userId: ctx.user.id,
        organizationId: ctx.tenant.organizationId,
        establishmentId: ctx.tenant.establishmentId ?? null,
        action: "READ",
        entity: "PatientLocationTrace",
        entityId: patient.id,
      },
    });

    return { patientId: patient.id, gsrn: patient.gsrn, events };
  }),
});
