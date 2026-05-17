/**
 * ECE Triaje — Router tRPC (NTEC §3.4 Hoja de Triaje).
 *
 * Gestiona el documento formal `ece.hoja_triaje` como complemento al triage
 * HIS (schema public). Ciclo de vida: borrador → en_revision → firmado → validado.
 *
 * Procedures:
 *   eceTriaje.list          — lista paginada por episodio/paciente
 *   eceTriaje.get           — lectura de una hoja por id
 *   eceTriaje.create        — crea borrador (cualquier rol ECE)
 *   eceTriaje.firmar        — ENF firma la hoja (estado → firmado)
 *   eceTriaje.validar       — MT valida la hoja firmada (estado → validado)
 *   eceTriaje.linkToHisTriage — vincula con TriageEvaluation HIS
 *
 * Raw SQL contra ece.hoja_triaje (fuera del schema Prisma).
 * RLS via withWorkflowContext (SET LOCAL app.ece_personal_id, etc.).
 * Outbox: firmar emite `ece.triaje.firmado`.
 *
 * Autorización:
 *   - list/get/create: cualquier rol ECE (MC, MT, ENF, ARCH, DIR, ESP)
 *   - firmar: solo ENF
 *   - validar: solo MT
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";
import { withWorkflowContext } from "../../workflow/context";

// ─── Schemas Zod (inline para compatibilidad con worktree) ──────────────────
// Los schemas canónicos viven en @his/contracts/src/schemas/ece-triaje.ts;
// se duplican aquí porque el worktree resuelve @his/contracts desde el
// node_modules del repo raíz (que puede estar en main antes del merge).

const listTriajeEceInput = z.object({
  episodioId: z.string().uuid().optional(),
  pacienteId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const getTriajeEceInput = z.object({
  id: z.string().uuid(),
});

const createTriajeEceInput = z.object({
  instanciaId: z.string().uuid(),
  episodioId: z.string().uuid(),
  manchesterNivel: z.number().int().min(1).max(5),
  motivoConsulta: z.string().min(1).max(2000),
  tiempoEsperaMin: z.number().int().min(0).max(1440),
  triageId: z.string().uuid().optional(),
  signosVitalesId: z.string().uuid().optional(),
  destinoAsignado: z.string().max(200).optional(),
});

const firmarTriajeEceInput = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid(),
});

const validarTriajeEceInput = z.object({
  id: z.string().uuid(),
  observacion: z.string().max(1000).optional(),
});

const linkToHisTriageInput = z.object({
  id: z.string().uuid(),
  triageId: z.string().uuid(),
});

// ─── Tipos fila raw ──────────────────────────────────────────────────────────

export interface HojaTriajeRow {
  id: string;
  instancia_id: string;
  episodio_id: string;
  fecha_hora_clasificacion: Date;
  motivo_consulta: string | null;
  nivel_prioridad: string;
  destino_asignado: string | null;
  signos_vitales_id: string | null;
  evaluacion_triaje: unknown;
  registrado_por: string;
  registrado_en: Date;
  estado_registro: string;
  his_triage_id: string | null;
  tiempo_espera_min: number | null;
  estado_workflow: string | null;
}

// ─── Columnas SELECT reutilizables ───────────────────────────────────────────

const SELECT_COLS = Prisma.sql`
  ht.id::text,
  ht.instancia_id::text,
  ht.episodio_id::text,
  ht.fecha_hora_clasificacion,
  ht.motivo_consulta,
  ht.nivel_prioridad,
  ht.destino_asignado,
  ht.signos_vitales_id::text,
  ht.evaluacion_triaje,
  ht.registrado_por::text,
  ht.registrado_en,
  ht.estado_registro,
  (ht.evaluacion_triaje ->> 'his_triage_id')          AS his_triage_id,
  (ht.evaluacion_triaje ->> 'tiempo_espera_min')::int AS tiempo_espera_min,
  (ht.evaluacion_triaje ->> 'estado_workflow')        AS estado_workflow
`;

// ─── Helper: EceContext desde ctx ───────────────────────────────────────────

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}) {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar documentos ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

// ─── Procedures base ────────────────────────────────────────────────────────

const eceBase = requireRole(["MC", "MT", "ENF", "ARCH", "DIR", "ESP"]);
const enfBase = requireRole(["ENF"]);
const mtBase = requireRole(["MT"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const triajeEceRouter = router({
  /**
   * Lista hojas de triaje ECE paginadas.
   * Filtra opcionalmente por episodio o paciente (vía instancia).
   */
  list: eceBase.input(listTriajeEceInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // Construir filtros dinámicos con Prisma.sql (parametrizados, sin injection).
      const filters: ReturnType<typeof Prisma.sql>[] = [];
      if (input.episodioId) {
        filters.push(Prisma.sql`AND ht.episodio_id = ${input.episodioId}::uuid`);
      }
      if (input.pacienteId) {
        filters.push(Prisma.sql`AND di.paciente_id = ${input.pacienteId}::uuid`);
      }
      if (input.cursor) {
        filters.push(Prisma.sql`AND ht.registrado_en < (
          SELECT registrado_en FROM ece.hoja_triaje WHERE id = ${input.cursor}::uuid
        )`);
      }
      const whereClause = filters.length > 0
        ? Prisma.join(filters, " ")
        : Prisma.empty;

      return tx.$queryRaw<HojaTriajeRow[]>(Prisma.sql`
        SELECT ${SELECT_COLS}
        FROM ece.hoja_triaje ht
        JOIN ece.documento_instancia di ON di.id = ht.instancia_id
        WHERE 1=1 ${whereClause}
        ORDER BY ht.registrado_en DESC
        LIMIT ${input.limit}
      `);
    });
  }),

  /** Devuelve una hoja de triaje ECE por id. */
  get: eceBase.input(getTriajeEceInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<HojaTriajeRow[]>(Prisma.sql`
        SELECT ${SELECT_COLS}
        FROM ece.hoja_triaje ht
        WHERE ht.id = ${input.id}::uuid
        LIMIT 1
      `);

      const row = rows[0] ?? null;
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Hoja de triaje ECE no encontrada." });
      }
      return row;
    });
  }),

  /**
   * Crea una hoja de triaje ECE en estado borrador.
   *
   * `nivel_prioridad` almacena el nivel Manchester (1–5) como string para
   * compatibilidad con el campo TEXT de la tabla. Metadatos adicionales
   * (his_triage_id, tiempo_espera_min, estado_workflow) van en JSONB
   * evaluacion_triaje para no alterar el DDL del documento base.
   */
  create: eceBase.input(createTriajeEceInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // Verificar que la instancia existe.
      const instRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT di.id::text
        FROM ece.documento_instancia di
        WHERE di.id = ${input.instanciaId}::uuid
        LIMIT 1
      `);

      if (instRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "La instancia de documento ECE no existe.",
        });
      }

      const evaluacionTriaje = JSON.stringify({
        his_triage_id: input.triageId ?? null,
        tiempo_espera_min: input.tiempoEsperaMin,
        estado_workflow: "borrador",
      });

      const signosId = input.signosVitalesId ?? null;
      const destino = input.destinoAsignado ?? null;

      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO ece.hoja_triaje (
          instancia_id,
          episodio_id,
          motivo_consulta,
          nivel_prioridad,
          destino_asignado,
          signos_vitales_id,
          evaluacion_triaje,
          registrado_por
        ) VALUES (
          ${input.instanciaId}::uuid,
          ${input.episodioId}::uuid,
          ${input.motivoConsulta},
          ${String(input.manchesterNivel)},
          ${destino},
          ${signosId}::uuid,
          ${evaluacionTriaje}::jsonb,
          ${eceCtx.personalId}::uuid
        )
        RETURNING id::text
      `);

      return { id: rows[0]!.id };
    });
  }),

  /**
   * ENF firma la hoja de triaje.
   * Transición: borrador/en_revision → firmado.
   * Emite evento outbox `ece.triaje.firmado`.
   *
   * Requiere rol ENF.
   */
  firmar: enfBase.input(firmarTriajeEceInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // 1. Leer hoja actual.
      const rows = await tx.$queryRaw<{
        id: string;
        instancia_id: string;
        episodio_id: string;
        nivel_prioridad: string;
        estado_workflow: string | null;
      }[]>(Prisma.sql`
        SELECT
          id::text,
          instancia_id::text,
          episodio_id::text,
          nivel_prioridad,
          (evaluacion_triaje ->> 'estado_workflow') AS estado_workflow
        FROM ece.hoja_triaje
        WHERE id = ${input.id}::uuid
        LIMIT 1
      `);

      const hoja = rows[0] ?? null;
      if (!hoja) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Hoja de triaje ECE no encontrada." });
      }

      const estadoActual = hoja.estado_workflow ?? "borrador";
      if (!["borrador", "en_revision"].includes(estadoActual)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Solo se puede firmar en estado borrador o en_revision. Estado actual: ${estadoActual}.`,
        });
      }

      // 2. Verificar que firmaId pertenece al usuario y está activa.
      const firmaRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT fe.id::text
        FROM ece.firma_electronica fe
        JOIN ece.personal_salud ps ON ps.id = fe.personal_id
        WHERE fe.id = ${input.firmaId}::uuid
          AND ps.his_user_id = ${ctx.user.id}::uuid
          AND fe.revoked_at IS NULL
        LIMIT 1
      `);

      if (firmaRows.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "La firma electrónica no existe o no pertenece al usuario.",
        });
      }

      // 3. Actualizar estado_workflow en JSONB (inmutable; no alter DDL).
      const firmadoEn = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        UPDATE ece.hoja_triaje
        SET evaluacion_triaje = evaluacion_triaje
          || jsonb_build_object(
               'estado_workflow', 'firmado',
               'firmado_por', ${ctx.user.id},
               'firma_id', ${input.firmaId},
               'firmado_en', ${firmadoEn}
             )
        WHERE id = ${input.id}::uuid
      `);

      // 4. Emitir evento outbox (dentro de la misma tx → atómico).
      await emitDomainEvent(tx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.triaje.firmado",
        aggregateType: "HojaTriaje",
        aggregateId: hoja.id,
        emittedById: ctx.user.id,
        payload: {
          hojaTriajeId: hoja.id,
          instanciaId: hoja.instancia_id,
          episodioId: hoja.episodio_id,
          manchesterNivel: Number(hoja.nivel_prioridad),
          firmadoPorId: ctx.user.id,
        },
      });

      return { id: hoja.id, estado: "firmado" as const };
    });
  }),

  /**
   * MT valida la hoja firmada.
   * Transición: firmado → validado.
   *
   * Requiere rol MT.
   */
  validar: mtBase.input(validarTriajeEceInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<{
        id: string;
        estado_workflow: string | null;
      }[]>(Prisma.sql`
        SELECT
          id::text,
          (evaluacion_triaje ->> 'estado_workflow') AS estado_workflow
        FROM ece.hoja_triaje
        WHERE id = ${input.id}::uuid
        LIMIT 1
      `);

      const hoja = rows[0] ?? null;
      if (!hoja) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Hoja de triaje ECE no encontrada." });
      }

      if (hoja.estado_workflow !== "firmado") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Solo se puede validar una hoja firmada. Estado actual: ${hoja.estado_workflow ?? "borrador"}.`,
        });
      }

      const validadoEn = new Date().toISOString();
      const observacion = input.observacion ?? null;

      await tx.$executeRaw(Prisma.sql`
        UPDATE ece.hoja_triaje
        SET evaluacion_triaje = evaluacion_triaje
          || jsonb_build_object(
               'estado_workflow', 'validado',
               'validado_por', ${ctx.user.id},
               'validado_en', ${validadoEn},
               'observacion_mt', ${observacion}
             )
        WHERE id = ${input.id}::uuid
      `);

      return { id: hoja.id, estado: "validado" as const };
    });
  }),

  /**
   * Vincula la hoja ECE con un TriageEvaluation del sistema HIS.
   * Útil cuando el flow HIS llega a ECE después de la recepción rápida.
   */
  linkToHisTriage: eceBase.input(linkToHisTriageInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // Verificar que el TriageEvaluation existe en schema public.
      const triageEval = await ctx.prisma.triageEvaluation.findFirst({
        where: { id: input.triageId, organizationId: ctx.tenant.organizationId },
        select: { id: true },
      });

      if (!triageEval) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "TriageEvaluation HIS no encontrado en esta organización.",
        });
      }

      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE ece.hoja_triaje
        SET evaluacion_triaje = evaluacion_triaje
          || jsonb_build_object('his_triage_id', ${input.triageId})
        WHERE id = ${input.id}::uuid
        RETURNING id::text
      `);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Hoja de triaje ECE no encontrada." });
      }

      return { id: rows[0]!.id, linkedTriageId: input.triageId };
    });
  }),
});
