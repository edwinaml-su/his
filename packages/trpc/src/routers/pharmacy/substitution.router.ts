/**
 * Router tRPC: Sustitución genérico-comercial autorizada (US.F2.6.11).
 *
 * Flujo:
 *   1. Farmacéutico propone (`proposeSubstitution`) → status PENDIENTE_AUTORIZACION.
 *      Verifica equivalencia en catálogo (ece.gs1_gtin_sustitucion estado=AUTORIZADA).
 *      Si no existe → TRPCError BAD_REQUEST con code SIN_EQUIVALENCIA_AUTORIZADA.
 *      Emite evento "pharmacy.substitution.proposed" → notificación outbox al médico.
 *
 *   2. Médico prescriptor autoriza (`authorizeSubstitution`) → status AUTORIZADA.
 *      Solo el médico que emitió la prescripción puede autorizar.
 *      Emite evento "pharmacy.substitution.authorized".
 *
 *   3. Médico prescriptor rechaza (`rejectSubstitution`) → status RECHAZADA.
 *      Emite evento "pharmacy.substitution.rejected".
 *
 *   4. Médico lista sus pendientes (`listPending`).
 *      Farmacéutico puede consultar estado (`getStatus`).
 *
 * Seguridad:
 *   - `withTenantContext` obligatorio en toda mutación.
 *   - Autorizar/rechazar: requireRole MEDICO + validación esPrescriptor.
 *   - Proponer: requireRole PHARM.
 *   - EPCIS WHAT dimension: columna generada `epcis_what` lista para el
 *     evento de dispensación posterior.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { withTenantContext } from "../../rls-context";
import { router, requireRole, tenantProcedure } from "../../trpc";
import { emitDomainEvent } from "@his/database";

// ---------------------------------------------------------------------------
// Schemas Zod de entrada
// ---------------------------------------------------------------------------

const proposeInput = z.object({
  prescriptionId:     z.string().uuid(),
  prescriptionItemId: z.string().uuid(),
  gtinOriginal:       z.string().length(14).regex(/^\d{14}$/),
  gtinSustituto:      z.string().length(14).regex(/^\d{14}$/),
});

const decisionInput = z.object({
  substitutionId: z.string().uuid(),
  motivo:         z.string().min(1, "El motivo es obligatorio").max(1000),
});

// ---------------------------------------------------------------------------
// Tipos de filas SQL (Prisma usa $queryRawUnsafe porque pharmacy_substitution
// está en el schema ece — fuera del schema public que mapea Prisma).
// ---------------------------------------------------------------------------

type SubstitutionRow = {
  id: string;
  prescription_id: string;
  prescription_item_id: string;
  organization_id: string;
  gtin_original: string;
  gtin_sustituto: string;
  sustitucion_catalogo_id: string;
  status: string;
  propuesto_por_id: string;
  propuesto_en: Date;
  autorizado_por_id: string | null;
  autorizado_en: Date | null;
  motivo: string | null;
  epcis_what: Record<string, string>;
  creado_en: Date;
  actualizado_en: Date;
};

type CatalogoRow = {
  id: string;
  gtin_original: string;
  gtin_sustituto: string;
  estado: string;
};

type PrescriptionRow = {
  id: string;
  prescriber_id: string;
};

function mapSubstitution(r: SubstitutionRow) {
  return {
    id: r.id,
    prescriptionId: r.prescription_id,
    prescriptionItemId: r.prescription_item_id,
    organizationId: r.organization_id,
    gtinOriginal: r.gtin_original,
    gtinSustituto: r.gtin_sustituto,
    catalogoId: r.sustitucion_catalogo_id,
    status: r.status,
    propuestoPorId: r.propuesto_por_id,
    propuestoEn: r.propuesto_en,
    autorizadoPorId: r.autorizado_por_id,
    autorizadoEn: r.autorizado_en,
    motivo: r.motivo,
    epcisWhat: r.epcis_what,
    creadoEn: r.creado_en,
    actualizadoEn: r.actualizado_en,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const pharmacySubstitutionRouter = router({
  /**
   * Farmacéutico propone una sustitución.
   * Requiere rol PHARM.
   * Verifica que exista equivalencia AUTORIZADA en catálogo antes de crear.
   */
  proposeSubstitution: requireRole(["PHARM", "ADMIN"])
    .input(proposeInput)
    .mutation(async ({ ctx, input }) => {
      const result = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // 1. Verificar equivalencia autorizada en catálogo
        const catalogoRows = await tx.$queryRawUnsafe<CatalogoRow[]>(
          `SELECT id, gtin_original, gtin_sustituto, estado
             FROM ece.gs1_gtin_sustitucion
            WHERE gtin_original = $1
              AND gtin_sustituto = $2
              AND estado = 'AUTORIZADA'
            LIMIT 1`,
          input.gtinOriginal,
          input.gtinSustituto,
        );

        if (catalogoRows.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "SIN_EQUIVALENCIA_AUTORIZADA: no existe relación de sustitución aprobada entre los GTIN indicados.",
          });
        }

        const catalogo = catalogoRows[0]!;

        // 2. Obtener prescriptor de la receta (para notificación y verificación posterior)
        const prescRows = await tx.$queryRawUnsafe<PrescriptionRow[]>(
          `SELECT id, "prescriberId" AS prescriber_id
             FROM public."Prescription"
            WHERE id = $1::uuid
              AND "organizationId" = $2::uuid
            LIMIT 1`,
          input.prescriptionId,
          ctx.tenant.organizationId,
        );

        if (prescRows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Receta no encontrada o no pertenece a esta organización.",
          });
        }

        const prescriptor = prescRows[0]!;

        // 3. Crear la sustitución
        type IdRow = { id: string };
        const insertRows = await tx.$queryRawUnsafe<IdRow[]>(
          `INSERT INTO ece.pharmacy_substitution
             (prescription_id, prescription_item_id, organization_id,
              gtin_original, gtin_sustituto, sustitucion_catalogo_id,
              propuesto_por_id, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid, $7::uuid, 'PENDIENTE_AUTORIZACION')
           RETURNING id`,
          input.prescriptionId,
          input.prescriptionItemId,
          ctx.tenant.organizationId,
          input.gtinOriginal,
          input.gtinSustituto,
          catalogo.id,
          ctx.user.id,
        );

        const substitutionId = insertRows[0]!.id;

        // 4. Emitir evento outbox → notificación al médico prescriptor
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "pharmacy.substitution.proposed",
          aggregateType: "PharmacySubstitution",
          aggregateId: substitutionId,
          emittedById: ctx.user.id,
          payload: {
            substitutionId,
            prescriptionId: input.prescriptionId,
            prescriptionItemId: input.prescriptionItemId,
            gtinOriginal: input.gtinOriginal,
            gtinSustituto: input.gtinSustituto,
            prescriptorUserId: prescriptor.prescriber_id,
            farmaceuticoUserId: ctx.user.id,
          },
        });

        return { substitutionId, prescriptorUserId: prescriptor.prescriber_id };
      });

      return result;
    }),

  /**
   * Médico prescriptor autoriza la sustitución.
   * Requiere rol MEDICO + ser el prescriptor de la receta.
   */
  authorizeSubstitution: requireRole(["MEDICO", "ADMIN"])
    .input(decisionInput)
    .mutation(async ({ ctx, input }) => {
      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // 1. Cargar la sustitución
        const rows = await tx.$queryRawUnsafe<SubstitutionRow[]>(
          `SELECT ps.*, p."prescriberId" AS prescriber_check
             FROM ece.pharmacy_substitution ps
             JOIN public."Prescription" p ON p.id = ps.prescription_id
            WHERE ps.id = $1::uuid
              AND ps.organization_id = $2::uuid
            LIMIT 1`,
          input.substitutionId,
          ctx.tenant.organizationId,
        );

        if (rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sustitución no encontrada." });
        }

        const sub = rows[0]!;

        // 2. Verificar que el médico en sesión es el prescriptor
        const prescriberCheck = (sub as SubstitutionRow & { prescriber_check: string }).prescriber_check;
        if (prescriberCheck !== ctx.user.id && !ctx.tenant.roleCodes.includes("ADMIN")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Solo el médico prescriptor puede autorizar esta sustitución.",
          });
        }

        // 3. Verificar estado
        if (sub.status !== "PENDIENTE_AUTORIZACION") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Sustitución en estado ${sub.status} — no puede autorizarse.`,
          });
        }

        // 4. Actualizar
        await tx.$executeRawUnsafe(
          `UPDATE ece.pharmacy_substitution
              SET status = 'AUTORIZADA',
                  autorizado_por_id = $1::uuid,
                  autorizado_en = now(),
                  motivo = $2,
                  actualizado_en = now()
            WHERE id = $3::uuid`,
          ctx.user.id,
          input.motivo,
          input.substitutionId,
        );

        // 5. Evento outbox
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "pharmacy.substitution.authorized",
          aggregateType: "PharmacySubstitution",
          aggregateId: input.substitutionId,
          emittedById: ctx.user.id,
          payload: {
            substitutionId: input.substitutionId,
            prescriptionId: sub.prescription_id,
            gtinOriginal: sub.gtin_original,
            gtinSustituto: sub.gtin_sustituto,
            medicoUserId: ctx.user.id,
            motivo: input.motivo,
          },
        });
      });

      return { ok: true as const };
    }),

  /**
   * Médico prescriptor rechaza la sustitución.
   * Requiere rol MEDICO + ser el prescriptor de la receta.
   */
  rejectSubstitution: requireRole(["MEDICO", "ADMIN"])
    .input(decisionInput)
    .mutation(async ({ ctx, input }) => {
      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<SubstitutionRow[]>(
          `SELECT ps.*, p."prescriberId" AS prescriber_check
             FROM ece.pharmacy_substitution ps
             JOIN public."Prescription" p ON p.id = ps.prescription_id
            WHERE ps.id = $1::uuid
              AND ps.organization_id = $2::uuid
            LIMIT 1`,
          input.substitutionId,
          ctx.tenant.organizationId,
        );

        if (rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sustitución no encontrada." });
        }

        const sub = rows[0]!;

        const prescriberCheck = (sub as SubstitutionRow & { prescriber_check: string }).prescriber_check;
        if (prescriberCheck !== ctx.user.id && !ctx.tenant.roleCodes.includes("ADMIN")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Solo el médico prescriptor puede rechazar esta sustitución.",
          });
        }

        if (sub.status !== "PENDIENTE_AUTORIZACION") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Sustitución en estado ${sub.status} — no puede rechazarse.`,
          });
        }

        await tx.$executeRawUnsafe(
          `UPDATE ece.pharmacy_substitution
              SET status = 'RECHAZADA',
                  autorizado_por_id = $1::uuid,
                  autorizado_en = now(),
                  motivo = $2,
                  actualizado_en = now()
            WHERE id = $3::uuid`,
          ctx.user.id,
          input.motivo,
          input.substitutionId,
        );

        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "pharmacy.substitution.rejected",
          aggregateType: "PharmacySubstitution",
          aggregateId: input.substitutionId,
          emittedById: ctx.user.id,
          payload: {
            substitutionId: input.substitutionId,
            prescriptionId: sub.prescription_id,
            gtinOriginal: sub.gtin_original,
            gtinSustituto: sub.gtin_sustituto,
            medicoUserId: ctx.user.id,
            motivo: input.motivo,
          },
        });
      });

      return { ok: true as const };
    }),

  /**
   * Médico lista las sustituciones pendientes de su autorización.
   * Filtra por prescripciones donde el médico en sesión es el prescriptor.
   */
  listPending: requireRole(["MEDICO", "ADMIN"])
    .query(async ({ ctx }) => {
      const rows = await ctx.prisma.$queryRawUnsafe<SubstitutionRow[]>(
        `SELECT ps.*
           FROM ece.pharmacy_substitution ps
           JOIN public."Prescription" p ON p.id = ps.prescription_id
          WHERE ps.status = 'PENDIENTE_AUTORIZACION'
            AND ps.organization_id = $1::uuid
            AND p."prescriberId" = $2::uuid
          ORDER BY ps.propuesto_en ASC`,
        ctx.tenant.organizationId,
        ctx.user.id,
      );

      return rows.map(mapSubstitution);
    }),

  /**
   * Consulta el estado de una sustitución.
   * Accesible para farmacéuticos y médicos del tenant.
   */
  getStatus: tenantProcedure
    .input(z.object({ substitutionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRawUnsafe<SubstitutionRow[]>(
        `SELECT *
           FROM ece.pharmacy_substitution
          WHERE id = $1::uuid
            AND organization_id = $2::uuid
          LIMIT 1`,
        input.substitutionId,
        ctx.tenant.organizationId,
      );

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sustitución no encontrada." });
      }

      return mapSubstitution(rows[0]!);
    }),

  /**
   * Lista substituciones autorizadas para un ítem de receta.
   * Permite al bedside scanner verificar si el GTIN sustituto es aceptado.
   */
  listAuthorizedForItem: tenantProcedure
    .input(z.object({ prescriptionItemId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.$queryRawUnsafe<SubstitutionRow[]>(
        `SELECT *
           FROM ece.pharmacy_substitution
          WHERE prescription_item_id = $1::uuid
            AND organization_id = $2::uuid
            AND status = 'AUTORIZADA'
          ORDER BY autorizado_en DESC`,
        input.prescriptionItemId,
        ctx.tenant.organizationId,
      );

      return rows.map(mapSubstitution);
    }),
});
