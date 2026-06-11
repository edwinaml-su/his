/**
 * ECE — WHO Surgical Safety Checklist (OMS Cirugía Segura 2009).
 *
 * Tabla: ece.who_checklist
 * FK: acto_quirurgico_id → ece.acto_quirurgico(id)
 * Flujo: iniciado → sign_in_completo → time_out_completo → completo
 *
 * Procedures:
 *   eceWhoChecklist.get            — obtiene checklist por acto_quirurgico_id
 *   eceWhoChecklist.list           — lista checklists del establecimiento
 *   eceWhoChecklist.marcarSignIn   — completa Fase 1 (pre-anestesia)
 *   eceWhoChecklist.marcarTimeOut  — completa Fase 2 (pre-incisión)
 *   eceWhoChecklist.marcarSignOut  — completa Fase 3 (post-cierre)
 *
 * Emite evento: ece.who_checklist.completado (solo en marcarSignOut exitoso)
 *
 * RLS Cat-E: set_ece_context en cada mutación.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Schemas Zod — ítem WHO individual
// ---------------------------------------------------------------------------

const whoItemSchema = z.object({
  clave: z.string().min(1).max(100),
  label: z.string().min(1).max(300),
  verificado: z.boolean(),
  observacion: z.string().max(1000).optional(),
  detalle: z.string().max(1000).optional(),
});

export type WhoItem = z.infer<typeof whoItemSchema>;

// HE-17 (audit Stream E): `responsableId` lo determina el server desde ctx.user.
// El cliente NO debe enviarlo (no es trust boundary). Si llega, el server lo sobrescribe.
// Mantengo el campo opcional para retro-compatibilidad de lectura del blob jsonb.

// Fase Sign-In: 8 ítems estándar WHO 2009 §1
export const whoSignInSchema = z.object({
  responsableId: z.string().uuid().optional(),
  responsableNombre: z.string().min(1).max(200),
  items: z.array(whoItemSchema).min(1).max(20),
});

// Fase Time-Out: 7 ítems estándar WHO 2009 §2
export const whoTimeOutSchema = z.object({
  responsableId: z.string().uuid().optional(),
  responsableNombre: z.string().min(1).max(200),
  items: z.array(whoItemSchema).min(1).max(20),
});

// Fase Sign-Out: 5 ítems estándar WHO 2009 §3
export const whoSignOutSchema = z.object({
  responsableId: z.string().uuid().optional(),
  responsableNombre: z.string().min(1).max(200),
  items: z.array(whoItemSchema).min(1).max(20),
});

export type WhoSignIn  = z.infer<typeof whoSignInSchema>;
export type WhoTimeOut = z.infer<typeof whoTimeOutSchema>;
export type WhoSignOut = z.infer<typeof whoSignOutSchema>;

// ---------------------------------------------------------------------------
// Inputs de procedures
// ---------------------------------------------------------------------------

const marcarSignInInput = z.object({
  actoQuirurgicoId: z.string().uuid(),
  /** Si el checklist no existe aún, se crea en el mismo call. */
  signIn: whoSignInSchema,
});

const marcarTimeOutInput = z.object({
  actoQuirurgicoId: z.string().uuid(),
  timeOut: whoTimeOutSchema,
});

const marcarSignOutInput = z.object({
  actoQuirurgicoId: z.string().uuid(),
  signOut: whoSignOutSchema,
});

const getInput = z.object({
  actoQuirurgicoId: z.string().uuid(),
});

const listInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  estado: z.enum(["iniciado", "sign_in_completo", "time_out_completo", "completo"]).optional(),
});

// ---------------------------------------------------------------------------
// Tipo de fila retornada por raw queries
// ---------------------------------------------------------------------------

type ChecklistRow = {
  id: string;
  acto_quirurgico_id: string;
  estado: string;
  fase_sign_in: WhoSignIn & { completado_en: string } | null;
  fase_time_out: WhoTimeOut & { completado_en: string } | null;
  fase_sign_out: WhoSignOut & { completado_en: string } | null;
  registrado_por: string;
  registrado_en: string;
  actualizado_en: string;
};

// ---------------------------------------------------------------------------
// Helper: contexto ECE para withWorkflowContext (HE-15)
// ---------------------------------------------------------------------------

/**
 * HE-15 (audit Stream E): resuelve personal_salud del usuario y devuelve
 * EceContext. Sin este envoltorio, RLS de `ece.who_checklist` no aplica y
 * un usuario podría leer/modificar checklists de cualquier establecimiento
 * conociendo solo el actoQuirurgicoId.
 */
async function buildEceCtx(
  prisma: PrismaClient,
  userId: string,
  establecimientoId: string,
): Promise<EceContext> {
  const personalRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ece.personal_salud
    WHERE his_user_id = ${userId}::uuid
    LIMIT 1
  `;
  if (personalRows.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No existe registro de personal de salud para este usuario.",
    });
  }
  return { personalId: personalRows[0]!.id, establecimientoId };
}

function resolveEstablecimiento(ctx: { tenant: { establishmentId?: string } }): string {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para el WHO checklist.",
    });
  }
  return ctx.tenant.establishmentId;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eceWhoChecklistRouter = router({
  /**
   * Obtiene el checklist WHO de un acto quirúrgico.
   */
  get: requireRole(["PHYSICIAN", "NURSE", "ANEST"])
    .input(getInput)
    .query(async ({ ctx, input }) => {
      const establecimientoId = resolveEstablecimiento(ctx);
      const eceCtx = await buildEceCtx(ctx.prisma, ctx.user!.id, establecimientoId);

      const rows = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        return (tx.$queryRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<ChecklistRow[]>)`
          SELECT
            id,
            acto_quirurgico_id,
            estado,
            fase_sign_in,
            fase_time_out,
            fase_sign_out,
            registrado_por,
            registrado_en::text,
            actualizado_en::text
          FROM ece.who_checklist
          WHERE acto_quirurgico_id = ${input.actoQuirurgicoId}::uuid
          LIMIT 1
        `;
      });
      return rows[0] ?? null;
    }),

  /**
   * Lista checklists del establecimiento (filtro opcional por estado).
   */
  list: requireRole(["PHYSICIAN", "NURSE", "DIR", "ANEST"])
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const establecimientoId = resolveEstablecimiento(ctx);
      const eceCtx = await buildEceCtx(ctx.prisma, ctx.user!.id, establecimientoId);
      const estadoFilter = input.estado ?? null;

      // HE-15: filtrado por establecimiento aplica vía RLS (set_ece_context).
      // El WHERE explícito previo comparaba establecimiento_id con organizationId
      // (campos distintos) — bug latente. Ahora RLS aplica el establecimiento real.
      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        return (tx.$queryRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<ChecklistRow[]>)`
          SELECT
            w.id,
            w.acto_quirurgico_id,
            w.estado,
            w.fase_sign_in,
            w.fase_time_out,
            w.fase_sign_out,
            w.registrado_por,
            w.registrado_en::text,
            w.actualizado_en::text
          FROM ece.who_checklist w
          WHERE (${estadoFilter}::text IS NULL OR w.estado = ${estadoFilter}::text)
          ORDER BY w.registrado_en DESC
          LIMIT ${input.limit}
          OFFSET ${input.offset}
        `;
      });
    }),

  /**
   * Completa la Fase 1 (sign-in, pre-anestesia).
   * Crea el checklist si no existe.
   * Transición: iniciado → sign_in_completo.
   */
  marcarSignIn: requireRole(["PHYSICIAN", "NURSE", "ANEST"])
    .input(marcarSignInInput)
    .mutation(async ({ ctx, input }) => {
      const establecimientoId = resolveEstablecimiento(ctx);
      const eceCtx = await buildEceCtx(ctx.prisma, ctx.user!.id, establecimientoId);
      const personalId = ctx.user!.id;

      // HE-17: server override del responsableId — el blob jsonb queda consistente
      // con el `registrado_por` y no acepta UUID falso del cliente.
      const signInPayload = JSON.stringify({
        ...input.signIn,
        responsableId: personalId,
        completado_en: new Date().toISOString(),
      });

      // HE-15: todo el flujo dentro de withWorkflowContext para que RLS aplique.
      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        // Verificar que el acto quirúrgico exista (RLS de ece.acto_quirurgico filtra por establecimiento).
        const actoRows = await (tx.$queryRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ id: string }>>)`
          SELECT id FROM ece.acto_quirurgico
          WHERE id = ${input.actoQuirurgicoId}::uuid
          LIMIT 1
        `;
        if (!actoRows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Acto quirúrgico no encontrado." });
        }

        // Upsert: si no existe → crea con estado sign_in_completo.
        // Si existe y está en "iniciado" → actualiza.
        const existing = await (tx.$queryRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ id: string; estado: string }>>)`
          SELECT id, estado FROM ece.who_checklist
          WHERE acto_quirurgico_id = ${input.actoQuirurgicoId}::uuid
          LIMIT 1
        `;

        if (!existing[0]) {
          const newRows = await (tx.$queryRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ id: string }>>)`
            INSERT INTO ece.who_checklist
              (acto_quirurgico_id, estado, fase_sign_in, registrado_por)
            VALUES
              (${input.actoQuirurgicoId}::uuid, 'sign_in_completo', ${signInPayload}::jsonb, ${personalId}::uuid)
            RETURNING id
          `;
          return { id: newRows[0]!.id, estado: "sign_in_completo" };
        }

        if (existing[0].estado !== "iniciado") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Sign-In ya fue completado. Estado actual: ${existing[0].estado}.`,
          });
        }

        await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
          UPDATE ece.who_checklist
          SET fase_sign_in = ${signInPayload}::jsonb,
              estado = 'sign_in_completo'
          WHERE id = ${existing[0].id}::uuid
        `;

        return { id: existing[0].id, estado: "sign_in_completo" };
      });
    }),

  /**
   * Completa la Fase 2 (time-out, pre-incisión).
   * Transición: sign_in_completo → time_out_completo.
   */
  marcarTimeOut: requireRole(["PHYSICIAN", "NURSE", "ANEST"])
    .input(marcarTimeOutInput)
    .mutation(async ({ ctx, input }) => {
      const establecimientoId = resolveEstablecimiento(ctx);
      const eceCtx = await buildEceCtx(ctx.prisma, ctx.user!.id, establecimientoId);

      // HE-17: server override del responsableId.
      const timeOutPayload = JSON.stringify({
        ...input.timeOut,
        responsableId: ctx.user!.id,
        completado_en: new Date().toISOString(),
      });

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const rows = await (tx.$queryRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ id: string; estado: string }>>)`
          SELECT id, estado FROM ece.who_checklist
          WHERE acto_quirurgico_id = ${input.actoQuirurgicoId}::uuid
          LIMIT 1
        `;
        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Checklist no encontrado. Completa el Sign-In primero." });
        }
        if (rows[0].estado !== "sign_in_completo") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Se requiere estado sign_in_completo. Estado actual: ${rows[0].estado}.`,
          });
        }

        await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
          UPDATE ece.who_checklist
          SET fase_time_out = ${timeOutPayload}::jsonb,
              estado = 'time_out_completo'
          WHERE id = ${rows[0].id}::uuid
        `;

        return { id: rows[0].id, estado: "time_out_completo" };
      });
    }),

  /**
   * Completa la Fase 3 (sign-out, post-cierre).
   * Transición: time_out_completo → completo.
   * Emite: ece.who_checklist.completado
   */
  marcarSignOut: requireRole(["PHYSICIAN", "NURSE", "ANEST"])
    .input(marcarSignOutInput)
    .mutation(async ({ ctx, input }) => {
      const establecimientoId = resolveEstablecimiento(ctx);
      const eceCtx = await buildEceCtx(ctx.prisma, ctx.user!.id, establecimientoId);

      // HE-17: server override del responsableId.
      const signOutPayload = JSON.stringify({
        ...input.signOut,
        responsableId: ctx.user!.id,
        completado_en: new Date().toISOString(),
      });

      const result = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const rows = await (tx.$queryRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ id: string; estado: string }>>)`
          SELECT id, estado FROM ece.who_checklist
          WHERE acto_quirurgico_id = ${input.actoQuirurgicoId}::uuid
          LIMIT 1
        `;
        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Checklist no encontrado. Completa Time-Out primero." });
        }
        if (rows[0].estado !== "time_out_completo") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Se requiere estado time_out_completo. Estado actual: ${rows[0].estado}.`,
          });
        }

        await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
          UPDATE ece.who_checklist
          SET fase_sign_out = ${signOutPayload}::jsonb,
              estado = 'completo'
          WHERE id = ${rows[0].id}::uuid
        `;

        return { id: rows[0].id };
      });

      // HE-16: outbox canónico con organizationId + aggregate. emitOutbox local
      // no proveía organization_id y rompía contrato con dispatcher.
      // emitDomainEvent abre su propia tx, debe ir fuera del withWorkflowContext.
      await emitDomainEvent(ctx.prisma, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.who_checklist.completado",
        aggregateType: "WhoChecklist",
        aggregateId: result.id,
        emittedById: ctx.user!.id,
        payload: {
          checklistId: result.id,
          actoQuirurgicoId: input.actoQuirurgicoId,
          completadoEn: new Date().toISOString(),
          completadoPor: ctx.user!.id,
        },
      });

      return { id: result.id, estado: "completo" };
    }),
});
