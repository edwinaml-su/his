/**
 * eceHistoriaClinica — CRUD + workflow de ece.historia_clinica.
 *
 * Tabla operada: ece.historia_clinica (schema ECE, raw SQL — sin modelo Prisma).
 * Workflow: HIST_CLIN con estados borrador → en_revision → firmado → validado → anulado.
 *
 * Autorización:
 *   - Lectura:  PHYSICIAN, NURSE, MC, MT, DIR
 *   - Escritura (create/update): MC, MT, DIR
 *   - firmar:   MC (Médico certificador)
 *   - validar:  DIR
 *   - enviarRevision / anular: MC, MT, DIR
 *
 * Toda transición registra en ece.documento_instancia_historial con sha256(payload).
 *
 * Spec: TDR §6 / Doc 2 NTEC / docs/backlog/fase2/
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import { Prisma } from "@his/database";
// Schemas inline — la copia canónica vive en packages/contracts/src/schemas/ece-historia-clinica.ts
// (el worktree no comparte node_modules con el monorepo principal, por eso no se importa desde allí).
const historiaClinicaListInput = z.object({
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const historiaClinicaGetInput = z.object({
  id: z.string().uuid(),
});

const historiaClinicaCreateInput = z.object({
  pacienteId: z.string().uuid(),
  episodioId: z.string().uuid().optional(),
  motivoConsulta: z.string().min(1).max(2000),
  antecedentes: z.string().max(5000).optional(),
  planInicial: z.string().max(5000).optional(),
});

const historiaClinicaUpdateInput = z.object({
  id: z.string().uuid(),
  motivoConsulta: z.string().min(1).max(2000).optional(),
  antecedentes: z.string().max(5000).optional(),
  planInicial: z.string().max(5000).optional(),
});

const historiaClinicaTransitionInput = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid().optional(),
  observacion: z.string().max(1000).optional(),
});
import type { EceContext } from "../../workflow/context";

// ─── Tipos de fila raw ───────────────────────────────────────────────────────

export interface HistoriaClinicaRow {
  id: string;
  paciente_id: string;
  episodio_id: string | null;
  motivo_consulta: string;
  antecedentes: string | null;
  plan_inicial: string | null;
  estado: string;
  instancia_id: string | null;
  creado_por: string;
  creado_en: Date;
  actualizado_en: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertFound<T>(row: T | undefined | null, label: string): T {
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: `${label} no encontrada.` });
  }
  return row;
}

/** Construye EceContext a partir del contexto tRPC. */
function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}): EceContext {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar Historia Clínica ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

/** sha256 del payload JSON serializado — se computa en SQL para evitar deps de crypto en edge. */
const SHA256_SQL = (payload: string): ReturnType<typeof Prisma.sql> =>
  Prisma.sql`encode(digest(${payload}, 'sha256'), 'hex')`;

/**
 * Registra una transición en ece.documento_instancia + ece.documento_instancia_historial.
 * Lanza CONFLICT si el estado actual no coincide con `estadoEsperado`.
 */
async function registrarTransicion(
  tx: Prisma.TransactionClient,
  opts: {
    historiaId: string;
    estadoEsperado: string;
    estadoNuevo: string;
    accion: string;
    ejecutadoPor: string;
    firmaId?: string;
    observacion?: string;
  },
): Promise<HistoriaClinicaRow> {
  // Leer estado actual + instancia_id
  const current = await tx.$queryRaw<{ estado: string; instancia_id: string | null }[]>(
    Prisma.sql`
      SELECT estado, instancia_id::text
      FROM ece.historia_clinica
      WHERE id = ${opts.historiaId}::uuid
      LIMIT 1
    `,
  );

  const row = assertFound(current[0], "HistoriaClinica");

  if (row.estado !== opts.estadoEsperado) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Estado actual '${row.estado}' no permite la acción '${opts.accion}'. Se esperaba '${opts.estadoEsperado}'.`,
    });
  }

  // UPDATE historia_clinica
  const updated = await tx.$queryRaw<HistoriaClinicaRow[]>(
    Prisma.sql`
      UPDATE ece.historia_clinica
      SET estado = ${opts.estadoNuevo}, actualizado_en = now()
      WHERE id = ${opts.historiaId}::uuid
      RETURNING
        id::text,
        paciente_id::text,
        episodio_id::text,
        motivo_consulta,
        antecedentes,
        plan_inicial,
        estado,
        instancia_id::text,
        creado_por::text,
        creado_en,
        actualizado_en
    `,
  );

  const updatedRow = assertFound(updated[0], "HistoriaClinica actualizada");

  // Construir payload para hash
  const payload = JSON.stringify({
    historiaId: opts.historiaId,
    estadoAnterior: opts.estadoEsperado,
    estadoNuevo: opts.estadoNuevo,
    accion: opts.accion,
    ejecutadoPor: opts.ejecutadoPor,
    ts: new Date().toISOString(),
  });

  // Registrar en instancia_historial si hay instancia ECE vinculada
  if (row.instancia_id) {
    await tx.$executeRaw(
      Prisma.sql`
        INSERT INTO ece.documento_instancia_historial
          (instancia_id, accion, ejecutado_por, firma_id, observacion, payload_hash)
        VALUES (
          ${row.instancia_id}::uuid,
          ${opts.accion},
          ${opts.ejecutadoPor}::uuid,
          ${opts.firmaId ?? null}::uuid,
          ${opts.observacion ?? null},
          ${SHA256_SQL(payload)}
        )
      `,
    );
  }

  return updatedRow;
}

// ─── Procedures base ─────────────────────────────────────────────────────────

const readBase = requireRole(["PHYSICIAN", "NURSE", "MC", "MT", "DIR"]);
const writeBase = requireRole(["MC", "MT", "DIR"]);
const mcBase = requireRole(["MC"]);
const dirBase = requireRole(["DIR"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceHistoriaClinicaRouter = router({
  /**
   * Lista historias clínicas con filtros opcionales.
   * Al menos un filtro (pacienteId o episodioId) es recomendado.
   */
  list: readBase.input(historiaClinicaListInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          SELECT
            id::text,
            paciente_id::text,
            episodio_id::text,
            motivo_consulta,
            antecedentes,
            plan_inicial,
            estado,
            instancia_id::text,
            creado_por::text,
            creado_en,
            actualizado_en
          FROM ece.historia_clinica
          WHERE
            (${input.pacienteId ?? null}::uuid IS NULL OR paciente_id = ${input.pacienteId ?? null}::uuid)
            AND (${input.episodioId ?? null}::uuid IS NULL OR episodio_id = ${input.episodioId ?? null}::uuid)
            AND (${input.cursor ?? null}::uuid IS NULL OR id > ${input.cursor ?? null}::uuid)
          ORDER BY id ASC
          LIMIT ${input.limit + 1}
        `,
      );

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]!.id : null;

      return { items, nextCursor };
    });
  }),

  /** Obtiene una historia clínica por id. */
  get: readBase.input(historiaClinicaGetInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          SELECT
            id::text,
            paciente_id::text,
            episodio_id::text,
            motivo_consulta,
            antecedentes,
            plan_inicial,
            estado,
            instancia_id::text,
            creado_por::text,
            creado_en,
            actualizado_en
          FROM ece.historia_clinica
          WHERE id = ${input.id}::uuid
          LIMIT 1
        `,
      );

      return assertFound(rows[0], "HistoriaClinica");
    });
  }),

  /**
   * Crea una historia clínica en estado 'borrador'.
   * El workflow_instance se crea por separado (workflow.instance.create con tipo HIST_CLIN).
   */
  create: writeBase.input(historiaClinicaCreateInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          INSERT INTO ece.historia_clinica
            (paciente_id, episodio_id, motivo_consulta, antecedentes, plan_inicial, estado, creado_por)
          VALUES (
            ${input.pacienteId}::uuid,
            ${input.episodioId ?? null}::uuid,
            ${input.motivoConsulta},
            ${input.antecedentes ?? null},
            ${input.planInicial ?? null},
            'borrador',
            ${eceCtx.personalId}::uuid
          )
          RETURNING
            id::text,
            paciente_id::text,
            episodio_id::text,
            motivo_consulta,
            antecedentes,
            plan_inicial,
            estado,
            instancia_id::text,
            creado_por::text,
            creado_en,
            actualizado_en
        `,
      );

      return assertFound(rows[0], "HistoriaClinica recién creada");
    });
  }),

  /**
   * Actualiza campos de la historia clínica.
   * Solo permitido en estado 'borrador' o 'en_revision'.
   */
  update: writeBase.input(historiaClinicaUpdateInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      // Verificar existencia y estado editable
      const current = await tx.$queryRaw<{ estado: string }[]>(
        Prisma.sql`SELECT estado FROM ece.historia_clinica WHERE id = ${input.id}::uuid LIMIT 1`,
      );
      const cur = assertFound(current[0], "HistoriaClinica");

      if (cur.estado !== "borrador" && cur.estado !== "en_revision") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La historia clínica en estado '${cur.estado}' no puede editarse. Solo en borrador o en_revision.`,
        });
      }

      const updates: ReturnType<typeof Prisma.sql>[] = [Prisma.sql`actualizado_en = now()`];
      if (input.motivoConsulta !== undefined)
        updates.push(Prisma.sql`motivo_consulta = ${input.motivoConsulta}`);
      if (input.antecedentes !== undefined)
        updates.push(Prisma.sql`antecedentes = ${input.antecedentes}`);
      if (input.planInicial !== undefined)
        updates.push(Prisma.sql`plan_inicial = ${input.planInicial}`);

      const setFragment = Prisma.join(updates, ", ");

      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          UPDATE ece.historia_clinica
          SET ${setFragment}
          WHERE id = ${input.id}::uuid
          RETURNING
            id::text,
            paciente_id::text,
            episodio_id::text,
            motivo_consulta,
            antecedentes,
            plan_inicial,
            estado,
            instancia_id::text,
            creado_por::text,
            creado_en,
            actualizado_en
        `,
      );

      return assertFound(rows[0], "HistoriaClinica");
    });
  }),

  /** Avanza de 'borrador' → 'en_revision'. Roles: MC, MT, DIR. */
  enviarRevision: writeBase
    .input(historiaClinicaTransitionInput)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceContext(ctx.prisma, eceCtx, async (tx) => {
        return registrarTransicion(tx as unknown as Prisma.TransactionClient, {
          historiaId: input.id,
          estadoEsperado: "borrador",
          estadoNuevo: "en_revision",
          accion: "enviar_revision",
          ejecutadoPor: eceCtx.personalId,
          observacion: input.observacion,
        });
      });
    }),

  /** Avanza de 'en_revision' → 'firmado'. Solo rol MC. Requiere firmaId. */
  firmar: mcBase.input(historiaClinicaTransitionInput).mutation(async ({ ctx, input }) => {
    if (!input.firmaId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "La acción 'firmar' requiere firmaId (firma electrónica).",
      });
    }

    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      return registrarTransicion(tx as unknown as Prisma.TransactionClient, {
        historiaId: input.id,
        estadoEsperado: "en_revision",
        estadoNuevo: "firmado",
        accion: "firmar",
        ejecutadoPor: eceCtx.personalId,
        firmaId: input.firmaId,
        observacion: input.observacion,
      });
    });
  }),

  /** Avanza de 'firmado' → 'validado'. Solo rol DIR. Requiere firmaId. */
  validar: dirBase.input(historiaClinicaTransitionInput).mutation(async ({ ctx, input }) => {
    if (!input.firmaId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "La acción 'validar' requiere firmaId (firma electrónica).",
      });
    }

    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx, async (tx) => {
      return registrarTransicion(tx as unknown as Prisma.TransactionClient, {
        historiaId: input.id,
        estadoEsperado: "firmado",
        estadoNuevo: "validado",
        accion: "validar",
        ejecutadoPor: eceCtx.personalId,
        firmaId: input.firmaId,
        observacion: input.observacion,
      });
    });
  }),

  /**
   * Anula la historia clínica desde cualquier estado no terminal.
   * Roles: MC, MT, DIR. Requiere observacion (Art. 53 NTEC).
   */
  anular: writeBase
    .input(
      historiaClinicaTransitionInput.extend({
        observacion: z.string().min(10).max(1000),
        estadoActual: z.enum(["borrador", "en_revision", "firmado", "validado"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceContext(ctx.prisma, eceCtx, async (tx) => {
        return registrarTransicion(tx as unknown as Prisma.TransactionClient, {
          historiaId: input.id,
          estadoEsperado: input.estadoActual,
          estadoNuevo: "anulado",
          accion: "anular",
          ejecutadoPor: eceCtx.personalId,
          observacion: input.observacion,
        });
      });
    }),
});
