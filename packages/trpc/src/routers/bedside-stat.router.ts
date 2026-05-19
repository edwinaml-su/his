/**
 * bedside-stat.router.ts — Modo STAT: bypass justificado bedside (US.F2.6.47)
 *
 * Hard-stops que SE BYPASSEAN en STAT:
 *   PACIENTE_NO_COINCIDE   → downgrade a warning
 *   MEDICAMENTO_NO_COINCIDE → downgrade a warning
 *   FUERA_DE_VENTANA        → downgrade a warning (alias HORA_FUERA_VENTANA)
 *
 * Hard-stops que NUNCA se bypassean (permanecen como hard-stop aunque STAT esté activo):
 *   PROFESIONAL_NO_HABILITADO (si aplica en futuro)
 *   LOTE_EN_RECALL            (si aplica en futuro)
 *   MEDICAMENTO_VENCIDO       (mapeado a DOSIS_INCORRECTA en bedside.router)
 *   GS1_PARSE_ERROR
 *   GSRN_PACIENTE_NO_ENCONTRADO
 *   INDICACION_INACTIVA
 *
 * Flujo:
 *   1. activate()  → crea sesión STAT (firma + testigos + motivo)
 *   2. getActive() → el wizard bedside consulta si hay STAT abierto
 *   3. complete()  → cierra la sesión ligándola a la administración registrada
 *
 * Sesión expira automáticamente a los 15 min (trigger ece.stat_event_expire_old).
 *
 * Auditoría: toda fila en ece.stat_event es inmutable post-completion
 *            (trigger trg_stat_event_immutability).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { router, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Enum de motivos STAT (sincronizar con CHECK constraint en BD)
// ---------------------------------------------------------------------------

export const STAT_MOTIVOS = [
  "PARO_CARDIORRESPIRATORIO",
  "HIPOGLUCEMIA_SEVERA",
  "ANAFILAXIA",
  "OTRO_URGENTE",
] as const;

export type StatMotivo = (typeof STAT_MOTIVOS)[number];

// Hard-stops bypassables en modo STAT
export const HARD_STOPS_BYPASSABLES = [
  "PACIENTE_NO_COINCIDE",
  "MEDICAMENTO_NO_COINCIDE",
  "FUERA_DE_VENTANA",
] as const;

export type BypassableHardStop = (typeof HARD_STOPS_BYPASSABLES)[number];

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const activateStatInput = z.object({
  indicationId: z.string().min(1),
  motivo: z.enum(STAT_MOTIVOS),
  /** Requerido cuando motivo = OTRO_URGENTE */
  motivoLibre: z.string().max(500).optional(),
  /** IDs de usuarios testigos (mínimo 1, puede ser 1 + DIR post-hoc) */
  testigos: z.array(z.string().uuid()).min(1).max(3),
  /** GSRN del médico autorizante para generar hash de firma */
  gsrnMedico: z.string().length(18).regex(/^\d{18}$/),
  encounterId: z.string().uuid().optional(),
  patientId: z.string().uuid(),
});

const getActiveInput = z.object({
  userId: z.string().uuid().optional(),
});

const completeStatInput = z.object({
  statEventId: z.string().uuid(),
  medicationAdministrationId: z.string().uuid().optional(),
  /** Hard-stops que efectivamente se bypasaron en esta administración */
  hardStopsBypassed: z.array(z.enum(HARD_STOPS_BYPASSABLES)).default([]),
});

const monthlyReportInput = z.object({
  organizationId: z.string().uuid(),
  mes: z.number().int().min(1).max(12),
  anio: z.number().int().min(2020).max(2100),
});

// ---------------------------------------------------------------------------
// Tipos de row raw
// ---------------------------------------------------------------------------

interface StatEventRow {
  id: string;
  organization_id: string;
  encounter_id: string | null;
  patient_id: string;
  indication_id: string;
  activado_por_id: string;
  motivo: StatMotivo;
  motivo_libre: string | null;
  testigos_ids: string[];
  hard_stops_bypassed: BypassableHardStop[];
  firma_medico_hash: string | null;
  activado_en: Date;
  completado_en: Date | null;
  medication_administration_id: string | null;
  completado: boolean;
}

interface ReportRow {
  motivo: StatMotivo;
  total: string;
  con_bypass: string;
}

// ---------------------------------------------------------------------------
// Helper: genera hash de firma STAT (GSRN médico + timestamp + indicationId)
// ---------------------------------------------------------------------------

function generarFirmaStatHash(
  gsrnMedico: string,
  activadoEn: Date,
  indicationId: string,
): string {
  return createHash("sha256")
    .update(`${gsrnMedico}|${activadoEn.toISOString()}|${indicationId}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const bedsideStatRouter = router({
  /**
   * Activa una sesión STAT para una indicación urgente.
   * Requiere rol MEDICO o ENF_JEFE.
   * Si motivo = OTRO_URGENTE, motivoLibre es obligatorio.
   */
  activate: requireRole(["MEDICO", "ENF_JEFE"])
    .input(activateStatInput)
    .mutation(async ({ ctx, input }) => {
      // Validar motivoLibre cuando motivo = OTRO_URGENTE
      if (input.motivo === "OTRO_URGENTE" && !input.motivoLibre?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "motivoLibre es obligatorio cuando motivo = OTRO_URGENTE.",
        });
      }

      // Verificar que no haya sesión STAT abierta para este usuario en esta org
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      const existing = await ctx.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM ece.stat_event
          WHERE organization_id = $1::uuid
            AND activado_por_id = $2::uuid
            AND completado = false
          LIMIT 1`,
        orgId,
        userId,
      );

      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ya existe una sesión STAT activa (id: ${existing[0]!.id}). Complétala antes de activar otra.`,
        });
      }

      const activadoEn = new Date();
      const firmaHash = generarFirmaStatHash(input.gsrnMedico, activadoEn, input.indicationId);

      const result = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO ece.stat_event
             (organization_id, encounter_id, patient_id, indication_id,
              activado_por_id, motivo, motivo_libre, testigos_ids,
              hard_stops_bypassed, firma_medico_hash, activado_en)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4,
                   $5::uuid, $6, $7, $8::uuid[],
                   $9::jsonb, $10, $11)
           RETURNING id`,
          orgId,
          input.encounterId ?? null,
          input.patientId,
          input.indicationId,
          userId,
          input.motivo,
          input.motivoLibre ?? null,
          `{${input.testigos.join(",")}}`,
          JSON.stringify([]),   // se actualiza en complete()
          firmaHash,
          activadoEn.toISOString(),
        );
        return rows[0]!.id;
      });

      return {
        statEventId: result,
        firmaHash,
        activadoEn,
        expiraEn: new Date(activadoEn.getTime() + 15 * 60_000),
      };
    }),

  /**
   * Retorna la sesión STAT abierta del usuario (o del userId especificado).
   * Usado por el wizard bedside antes de aplicar hard-stops.
   */
  getActive: requireRole(["MEDICO", "ENF_JEFE", "DIR"])
    .input(getActiveInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const targetUserId = input.userId ?? ctx.user.id;

      // Primero expirar sesiones viejas (fire-and-forget; no bloquea)
      ctx.prisma
        .$executeRawUnsafe(`SELECT ece.stat_event_expire_old()`)
        .catch(() => { /* no propagamos */ });

      const rows = await ctx.prisma.$queryRawUnsafe<StatEventRow[]>(
        `SELECT *
           FROM ece.stat_event
          WHERE organization_id = $1::uuid
            AND activado_por_id = $2::uuid
            AND completado = false
          ORDER BY activado_en DESC
          LIMIT 1`,
        orgId,
        targetUserId,
      );

      const event = rows[0];
      if (!event) return null;

      const now = new Date();
      const expiraEn = new Date(new Date(event.activado_en).getTime() + 15 * 60_000);

      return {
        statEventId: event.id,
        indicationId: event.indication_id,
        patientId: event.patient_id,
        motivo: event.motivo,
        motivoLibre: event.motivo_libre,
        activadoEn: event.activado_en,
        expiraEn,
        secsRestantes: Math.max(0, Math.floor((expiraEn.getTime() - now.getTime()) / 1000)),
        bypassableHardStops: HARD_STOPS_BYPASSABLES,
      };
    }),

  /**
   * Completa la sesión STAT, liga la administración registrada y
   * persiste los hard-stops que efectivamente se bypasaron.
   */
  complete: requireRole(["MEDICO", "ENF_JEFE"])
    .input(completeStatInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      // Verificar que el evento pertenece al usuario y a la org, y está abierto
      const existing = await ctx.prisma.$queryRawUnsafe<{ activado_por_id: string; completado: boolean }[]>(
        `SELECT activado_por_id, completado
           FROM ece.stat_event
          WHERE id = $1::uuid
            AND organization_id = $2::uuid
          LIMIT 1`,
        input.statEventId,
        orgId,
      );

      const ev = existing[0];
      if (!ev) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sesión STAT no encontrada." });
      }
      if (ev.completado) {
        throw new TRPCError({ code: "CONFLICT", message: "La sesión STAT ya fue completada." });
      }
      if (ev.activado_por_id !== userId) {
        // DIR puede completar sesiones de otros (post-hoc)
        const isDir = ctx.tenant.roleCodes.includes("DIR");
        if (!isDir) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Solo el activador o DIR puede completar la sesión STAT.",
          });
        }
      }

      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE ece.stat_event
              SET completado                  = true,
                  completado_en               = now(),
                  medication_administration_id = $2::uuid,
                  hard_stops_bypassed         = $3::jsonb
            WHERE id = $1::uuid`,
          input.statEventId,
          input.medicationAdministrationId ?? null,
          JSON.stringify(input.hardStopsBypassed),
        );
      });

      return { ok: true };
    }),

  /**
   * Reporte mensual de eventos STAT para DIR.
   * Retorna agregados por motivo + lista de drill-down.
   */
  monthlyReport: requireRole(["DIR"])
    .input(monthlyReportInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      // Verificar que el usuario pertenece a la org solicitada
      if (orgId !== input.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tienes acceso a esta organización.",
        });
      }

      const inicio = new Date(input.anio, input.mes - 1, 1);
      const fin    = new Date(input.anio, input.mes, 1);   // exclusive upper

      // Agregados por motivo
      const aggRows = await ctx.prisma.$queryRawUnsafe<ReportRow[]>(
        `SELECT
           motivo,
           COUNT(*)                                               AS total,
           COUNT(*) FILTER (WHERE jsonb_array_length(hard_stops_bypassed) > 0) AS con_bypass
           FROM ece.stat_event
          WHERE organization_id = $1::uuid
            AND activado_en >= $2
            AND activado_en <  $3
          GROUP BY motivo
          ORDER BY total DESC`,
        orgId,
        inicio.toISOString(),
        fin.toISOString(),
      );

      // Drill-down completo (max 200 filas por mes para evitar over-fetch)
      const detailRows = await ctx.prisma.$queryRawUnsafe<StatEventRow[]>(
        `SELECT *
           FROM ece.stat_event
          WHERE organization_id = $1::uuid
            AND activado_en >= $2
            AND activado_en <  $3
          ORDER BY activado_en DESC
          LIMIT 200`,
        orgId,
        inicio.toISOString(),
        fin.toISOString(),
      );

      return {
        mes: input.mes,
        anio: input.anio,
        total: detailRows.length,
        porMotivo: aggRows.map((r) => ({
          motivo: r.motivo,
          total: Number(r.total),
          conBypass: Number(r.con_bypass),
        })),
        eventos: detailRows.map((r) => ({
          id: r.id,
          patientId: r.patient_id,
          indicationId: r.indication_id,
          activadoPorId: r.activado_por_id,
          motivo: r.motivo,
          motivoLibre: r.motivo_libre,
          hardStopsBypassed: r.hard_stops_bypassed,
          activadoEn: r.activado_en,
          completadoEn: r.completado_en,
          completado: r.completado,
        })),
      };
    }),
});
