/**
 * ECE — Registro de Enfermería + Administración de Medicamento (MAR/Kardex).
 *
 * Documento NTEC: Doc 7 — Registro de Enfermería y Administración de Medicamento
 *   (MAR = Medication Administration Record / Kardex de Enfermería).
 * Norma: TDR §7 / MINSAL Acuerdo n.° 1616 (2024).
 * Código de tipo_documento: REG_ENF.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (código tipo: REG_ENF)
 * ---------------------------------------------------------------------------
 *   borrador    → en_revision  (NURSE: completar turno)
 *   en_revision → firmado      (NURSE: firma al final de turno)
 *   firmado     → validado     (NURSE coordinadora: cierre formal)
 *
 *   Estados son por cabecera (ece.registro_enfermeria); los ítems de
 *   administración (ece.administracion_medicamento) se insertan en borrador/en_revision.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext)
 * ---------------------------------------------------------------------------
 *   'ece.administracion.registrada'  — Stream 30. Emitido por registrarAdministracion().
 *     Payload: { registroId, indicacionItemId, horaAdministrada, enfermeroId, orgId }
 *   Usado por el motor de Kardex y BCMA para conciliar administraciones.
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.registro_enfermeria        — cabecera (episodio_id, fecha, turno,
 *                                    estado, observaciones, firmado_por, firmado_en)
 *   ece.administracion_medicamento — línea de detalle (registro_id,
 *                                    indicacion_item_id, hora_administrada,
 *                                    dosis_administrada, via_usada, observaciones)
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC (todas las procedures: requireRole(["NURSE"]))
 * ---------------------------------------------------------------------------
 *   list, get, create, update           → NURSE
 *   firmar, validar, registrarAdministracion → NURSE
 *
 * Raw SQL es obligatorio porque ece.* usa schema Postgres separado (opción B)
 * y no está en schema.prisma. Las queries usan prisma.$queryRaw con Prisma.sql.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { emitDomainEvent } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../workflow/context";
import { applyGs1Validation } from "../../gs1/require-gs1-validation";
import type { TenantContext } from "@his/contracts";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Schemas Zod locales
// (espejo de packages/contracts/src/schemas/ece-registro-enfermeria.ts)
// ---------------------------------------------------------------------------

const turnoEnum = z.enum(["matutino", "vespertino", "nocturno"]);

const eceRegistroCreateSchema = z.object({
  episodioId: z.string().uuid(),
  fecha: z.coerce.date(),
  turno: turnoEnum,
  observaciones: z.string().trim().max(2000).optional(),
});

const eceAdministracionSchema = z.object({
  registroId: z.string().uuid(),
  indicacionItemId: z.string().uuid(),
  horaAdministrada: z.coerce.date(),
  dosisAdministrada: z.string().trim().min(1).max(100),
  viaUsada: z.string().trim().min(1).max(80),
  observaciones: z.string().trim().max(2000).optional(),
  // Campos GS1 opcionales — cuando presentes activan validación 5 correctos obligatoria
  gs1: z.object({
    gtin: z.string().min(8).max(14),
    lote: z.string().min(1).max(80),
    expiry: z.coerce.date(),
    pacienteId: z.string().uuid(),
    pacienteGsrn: z.string().length(18).optional(),
    episodioId: z.string().uuid().optional(),
  }).optional(),
});

const eceRegistroListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const eceRegistroGetSchema = z.object({ id: z.string().uuid() });
const eceRegistroIdSchema   = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

export interface RegistroRow {
  id: string;
  episodio_id: string;
  personal_id: string;
  organization_id: string;
  fecha: Date;
  turno: string;
  estado: string;
  observaciones: string | null;
  creado_en: Date;
}

export interface IndicacionItemRow {
  id: string;
  estado: string;
  episodio_id: string;
}

interface AdministracionRow {
  id: string;
  registro_id: string;
  indicacion_item_id: string;
  hora_administrada: Date;
  dosis_administrada: string;
  via_usada: string;
  observaciones: string | null;
  registrado_por: string;
  registrado_en: Date;
}

// ---------------------------------------------------------------------------
// Helper de contexto ECE para este router
// ---------------------------------------------------------------------------

/**
 * Construye el EceContext desde el tenant+user del trpc ctx.
 * `personalId` se resuelve a partir de `ctx.user.id` — el personal_salud
 * vinculado al usuario HIS se obtiene en la consulta raw del router.
 * Aquí usamos el user.id como personalId provisional; la RLS del schema ece
 * lo valida contra `app.ece_personal_id`.
 */
function buildEceCtx(tenant: TenantContext, userId: string) {
  return {
    personalId: userId,
    establecimientoId: tenant.establishmentId ?? tenant.organizationId,
  };
}

/**
 * Aplica contexto ECE + ejecuta fn en una transacción.
 * Alias local de withWorkflowContext con el nombre semántico del módulo.
 */
async function withEceContext<T>(
  prisma: PrismaClient,
  tenant: TenantContext,
  userId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return withWorkflowContext(prisma, buildEceCtx(tenant, userId), fn);
}

// ---------------------------------------------------------------------------
// Helpers de consulta raw
// ---------------------------------------------------------------------------

async function findRegistro(
  prisma: Pick<PrismaClient, "$queryRaw">,
  id: string,
  orgId: string,
): Promise<RegistroRow | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<RegistroRow[]>)`
    SELECT id, episodio_id, personal_id, organization_id,
           fecha, turno, estado, observaciones, creado_en
    FROM ece.registro_enfermeria
    WHERE id = ${id}::uuid
      AND organization_id = ${orgId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findIndicacionItem(
  prisma: Pick<PrismaClient, "$queryRaw">,
  id: string,
  orgId: string,
): Promise<IndicacionItemRow | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<IndicacionItemRow[]>)`
    SELECT ii.id, ii.estado, i.episodio_id
    FROM ece.indicacion_item ii
    JOIN ece.indicacion i ON i.id = ii.indicacion_id
    WHERE ii.id = ${id}::uuid
      AND i.organization_id = ${orgId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const nurseRole = requireRole(["NURSE"]);

export const registroEnfermeriaRouter = router({
  /** Lista registros de jornada con filtros por episodioId y/o fecha. */
  list: nurseRole
    .input(eceRegistroListSchema)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      return (ctx.prisma.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<RegistroRow[]>)`
        SELECT id, episodio_id, personal_id, organization_id,
               fecha, turno, estado, observaciones, creado_en
        FROM ece.registro_enfermeria
        WHERE organization_id = ${orgId}::uuid
          AND (${input.episodioId ?? null}::uuid IS NULL
               OR episodio_id = ${input.episodioId ?? null}::uuid)
          AND (${input.fecha ?? null}::date IS NULL
               OR fecha = ${input.fecha ?? null}::date)
        ORDER BY fecha DESC, creado_en DESC
        LIMIT ${input.limit}
      `;
    }),

  /** Obtiene un registro de jornada por id. */
  get: nurseRole
    .input(eceRegistroGetSchema)
    .query(async ({ ctx, input }) => {
      const row = await findRegistro(
        ctx.prisma,
        input.id,
        ctx.tenant.organizationId,
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /** Crea la cabecera del registro de jornada (estado inicial: borrador). */
  create: nurseRole
    .input(eceRegistroCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        // Resolver personal_id a partir de his_user_id
        const personalRows = await (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          SELECT id FROM ece.personal_salud
          WHERE his_user_id = ${userId}::uuid
            AND activo = true
          LIMIT 1
        `;
        const personal = personalRows[0] ?? null;
        if (!personal) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No se encontró un profesional ECE asociado a su cuenta.",
          });
        }

        const rows = await (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          INSERT INTO ece.registro_enfermeria
            (episodio_id, personal_id, organization_id,
             fecha, turno, estado, observaciones, creado_en)
          VALUES
            (${input.episodioId}::uuid,
             ${personal.id}::uuid,
             ${orgId}::uuid,
             ${input.fecha}::date,
             ${input.turno},
             'borrador',
             ${input.observaciones ?? null},
             now())
          RETURNING id
        `;
        const created = rows[0];
        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No se pudo crear el registro de enfermería.",
          });
        }
        return { id: created.id };
      });
    }),

  /**
   * Agrega una fila a ece.administracion_medicamento para el registro de jornada.
   * Valida que la indicacion exista y no esté anulada.
   * Emite `ece.administracion.registrada` vía outbox transaccional.
   */
  registrarAdministracion: nurseRole
    .input(eceAdministracionSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      // Verificar que el registro padre existe y pertenece al tenant
      const registro = await findRegistro(
        ctx.prisma,
        input.registroId,
        orgId,
      );
      if (!registro) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Registro de enfermería no encontrado.",
        });
      }

      // Verificar indicacion_item existe y no está anulada
      const indicacion = await findIndicacionItem(
        ctx.prisma,
        input.indicacionItemId,
        orgId,
      );
      if (!indicacion) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La indicación referenciada no existe en la organización.",
        });
      }
      if (indicacion.estado === "anulada") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede registrar administración sobre una indicación anulada.",
        });
      }

      // Validación 5 correctos GS1 — enforcement obligatorio cuando se proveen campos GS1.
      // Falla con PRECONDITION_FAILED si algún "correcto" falla (severity=error).
      if (input.gs1) {
        await applyGs1Validation(ctx, {
          ...input.gs1,
          dosis: input.dosisAdministrada,
          via: input.viaUsada,
          hora: input.horaAdministrada,
          indicacionItemId: input.indicacionItemId,
        });
      }

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        const rows = await (tx.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>)`
          INSERT INTO ece.administracion_medicamento
            (registro_id, indicacion_item_id, hora_administrada,
             dosis_administrada, via_usada, observaciones,
             registrado_por, registrado_en)
          VALUES
            (${input.registroId}::uuid,
             ${input.indicacionItemId}::uuid,
             ${input.horaAdministrada}::timestamptz,
             ${input.dosisAdministrada},
             ${input.viaUsada},
             ${input.observaciones ?? null},
             ${userId}::uuid,
             now())
          RETURNING id
        `;
        const created = rows[0];
        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No se pudo registrar la administración.",
          });
        }

        const payload = {
          administracionId: created.id,
          registroId: input.registroId,
          indicacionItemId: input.indicacionItemId,
          episodioId: indicacion.episodio_id,
          enfermeraId: userId,
        };

        await emitDomainEvent(tx as unknown as PrismaClient, {
          organizationId: orgId,
          eventType: "ece.administracion.registrada",
          aggregateType: "AdministracionMedicamento",
          aggregateId: created.id,
          emittedById: userId,
          payload,
        });

        return { id: created.id };
      });
    }),

  /**
   * Firma el registro de jornada (ENF).
   * Transición: borrador | en_revision → firmado.
   */
  firmar: nurseRole
    .input(eceRegistroIdSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      const registro = await findRegistro(ctx.prisma, input.id, orgId);
      if (!registro) throw new TRPCError({ code: "NOT_FOUND" });

      const estadosPermitidos = ["borrador", "en_revision"];
      if (!estadosPermitidos.includes(registro.estado)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No se puede firmar un registro en estado '${registro.estado}'.`,
        });
      }

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.registro_enfermeria
          SET estado = 'firmado',
              firmado_por = ${userId}::uuid,
              firmado_en  = now()
          WHERE id = ${input.id}::uuid
            AND organization_id = ${orgId}::uuid
        `;
        return { ok: true as const };
      });
    }),

  /**
   * Valida el registro de jornada (ENF).
   * Transición: firmado → validado.
   */
  validar: nurseRole
    .input(eceRegistroIdSchema)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      const registro = await findRegistro(ctx.prisma, input.id, orgId);
      if (!registro) throw new TRPCError({ code: "NOT_FOUND" });

      if (registro.estado !== "firmado") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Solo se puede validar un registro en estado 'firmado'. Estado actual: '${registro.estado}'.`,
        });
      }

      return withEceContext(ctx.prisma, ctx.tenant, userId, async (tx) => {
        await (tx.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.registro_enfermeria
          SET estado      = 'validado',
              validado_por = ${userId}::uuid,
              validado_en  = now()
          WHERE id = ${input.id}::uuid
            AND organization_id = ${orgId}::uuid
        `;
        return { ok: true as const };
      });
    }),
});
