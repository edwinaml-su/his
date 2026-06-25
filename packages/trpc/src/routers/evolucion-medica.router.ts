/**
 * ECE — Evolución Médica (NTEC §3.8, EVOL_MED workflow).
 *
 * Tabla física: ece.evolucion_medica (raw SQL).
 * Estado de la nota: ece.documento_instancia.estado_actual_id → ece.flujo_estado.codigo.
 *   Estados: borrador → en_revision → firmado → validado | anulado
 *
 * Procedures:
 *   eceEvolucion.list    — filtros: episodioId, fecha, autorId
 *   eceEvolucion.get     — por id
 *   eceEvolucion.create  — campos SOAP requeridos; crea instancia en borrador
 *   eceEvolucion.update  — solo en estado borrador; requiere ser el autor
 *   eceEvolucion.firmar  — MC/MT; avanza a firmado; emite outbox ece.evolucion.firmada
 *   eceEvolucion.validar — MC; avanza a validado
 *
 * Autorización: requireRole(["PHYSICIAN"]) → rolCode MC ó MT.
 * Context helper: withEceContext (alias de withWorkflowContext con el ctx del caller).
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, requireRole } from "../trpc";
import { withWorkflowContext, type EceContext } from "../workflow/context";
import { emitDomainEvent } from "@his/database";
import {
  eceEvolucionCreateSchema,
  eceEvolucionUpdateSchema,
  eceEvolucionListSchema,
} from "@his/contracts";

// ─── Tipos de fila raw ───────────────────────────────────────────────────────

interface EvolucionRow {
  id: string;
  instancia_id: string;
  episodio_id: string;
  fecha_hora: Date;
  subjetivo: string | null;
  objetivo: string | null;
  analisis: string | null;
  plan: string | null;
  registrado_por: string;
  registrado_en: Date;
  estado_registro: string;
  /** estado_codigo resuelto desde la instancia (join en query). */
  estado_codigo: string;
  data: unknown | null;
}

// ─── Helper: EceContext ──────────────────────────────────────────────────────

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}): EceContext {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar evoluciones médicas.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

/**
 * Helper que envuelve la lógica en una transacción con contexto ECE.
 * Reutiliza withWorkflowContext del motor de workflow.
 */
async function withEceContext<T>(
  prisma: Parameters<typeof withWorkflowContext>[0],
  ctx: { user: { id: string }; tenant: { establishmentId?: string; roleCodes: string[] } },
  fn: Parameters<typeof withWorkflowContext>[2],
): Promise<T> {
  return withWorkflowContext(prisma, buildEceCtx(ctx), fn) as Promise<T>;
}

// ─── Helpers de estado ───────────────────────────────────────────────────────

/** Resuelve el estado_codigo de una instancia. */
async function getEstadoCodigo(
  tx: Parameters<typeof withWorkflowContext>[0],
  instanciaId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ codigo: string }[]>`
    SELECT fe.codigo
    FROM ece.documento_instancia di
    JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
    WHERE di.id = ${instanciaId}::uuid
    LIMIT 1
  `;
  return rows[0]?.codigo ?? null;
}

/** Avanza el estado de la instancia a targetCodigo buscando la transición válida. */
async function avanzarEstado(
  tx: Parameters<typeof withWorkflowContext>[0],
  instanciaId: string,
  targetCodigo: string,
  ejecutadoPor: string,
  accion: string,
): Promise<void> {
  // Obtener estado actual id
  const currentRows = await tx.$queryRaw<{ estado_actual_id: string }[]>`
    SELECT estado_actual_id::text AS estado_actual_id
    FROM ece.documento_instancia
    WHERE id = ${instanciaId}::uuid
    LIMIT 1
  `;
  if (currentRows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Instancia de documento no encontrada." });
  }
  const estadoActualId = currentRows[0]!.estado_actual_id;

  // Resolver id del estado destino
  const targetRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text
    FROM ece.flujo_estado
    WHERE codigo = ${targetCodigo}
    LIMIT 1
  `;
  if (targetRows.length === 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Estado ${targetCodigo} no está configurado.` });
  }
  const targetId = targetRows[0]!.id;

  await tx.$executeRaw`
    UPDATE ece.documento_instancia
    SET estado_actual_id = ${targetId}::uuid,
        version = version + 1
    WHERE id = ${instanciaId}::uuid
  `;

  await tx.$executeRaw`
    INSERT INTO ece.documento_instancia_historial
      (instancia_id, estado_anterior_id, estado_nuevo_id, accion, ejecutado_por)
    VALUES (
      ${instanciaId}::uuid,
      ${estadoActualId}::uuid,
      ${targetId}::uuid,
      ${accion},
      ${ejecutadoPor}::uuid
    )
  `;
}

// ─── Procedure base ──────────────────────────────────────────────────────────

const physicianProc = requireRole(["PHYSICIAN"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const evolucionMedicaRouter = router({
  list: physicianProc.input(eceEvolucionListSchema).query(async ({ ctx, input }) => {
    return withEceContext(ctx.prisma, ctx, async (tx) => {
      // Prisma $queryRaw no soporta interpolación dinámica de cláusulas SQL.
      // Se usan parámetros sentinel nulos para filtros opcionales.
      const episodioId = input.episodioId ?? null;
      const autorId = input.autorId ?? null;
      const fecha = input.fecha ?? null;
      const cursor = input.cursor ?? null;

      const rows = await tx.$queryRaw<EvolucionRow[]>`
        SELECT
          em.id::text,
          em.instancia_id::text,
          em.episodio_id::text,
          em.fecha_hora,
          em.subjetivo,
          em.objetivo,
          em.analisis,
          em.plan,
          em.data,
          em.registrado_por::text,
          em.registrado_en,
          em.estado_registro,
          fe.codigo AS estado_codigo
        FROM ece.evolucion_medica em
        JOIN ece.documento_instancia di ON di.id = em.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE (${episodioId}::uuid IS NULL OR em.episodio_id = ${episodioId}::uuid)
          AND (${autorId}::uuid IS NULL OR em.registrado_por = ${autorId}::uuid)
          AND (${fecha}::date IS NULL OR DATE(em.fecha_hora) = ${fecha}::date)
          AND (${cursor}::uuid IS NULL OR em.id < ${cursor}::uuid)
        ORDER BY em.fecha_hora DESC
        LIMIT ${input.limit}
      `;
      return rows;
    });
  }),

  get: physicianProc.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    return withEceContext(ctx.prisma, ctx, async (tx) => {
      const rows = await tx.$queryRaw<EvolucionRow[]>`
        SELECT
          em.id::text,
          em.instancia_id::text,
          em.episodio_id::text,
          em.fecha_hora,
          em.subjetivo,
          em.objetivo,
          em.analisis,
          em.plan,
          em.data,
          em.registrado_por::text,
          em.registrado_en,
          em.estado_registro,
          fe.codigo AS estado_codigo
        FROM ece.evolucion_medica em
        JOIN ece.documento_instancia di ON di.id = em.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE em.id = ${input.id}::uuid
        LIMIT 1
      `;
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Evolución médica no encontrada." });
      }
      return rows[0]!;
    });
  }),

  create: physicianProc.input(eceEvolucionCreateSchema).mutation(async ({ ctx, input }) => {
    return withEceContext(ctx.prisma, ctx, async (tx) => {
      // Resolver personal_id del usuario
      const personalRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text
        FROM ece.personal_salud
        WHERE his_user_id = ${ctx.user.id}::uuid AND activo = true
        LIMIT 1
      `;
      if (personalRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El usuario no tiene un perfil de personal de salud activo en ECE.",
        });
      }
      const personalId = personalRows[0]!.id;

      // Resolver tipo de documento EVOL_MED y estado inicial (borrador)
      const tipoRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text
        FROM ece.tipo_documento
        WHERE codigo = 'EVOL_MED'
        LIMIT 1
      `;
      if (tipoRows.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Tipo de documento EVOL_MED no configurado en el catálogo ECE.",
        });
      }
      const tipoDocumentoId = tipoRows[0]!.id;

      const estadoInicialRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text
        FROM ece.flujo_estado
        WHERE tipo_documento_id = ${tipoDocumentoId}::uuid AND es_inicial = true
        LIMIT 1
      `;
      if (estadoInicialRows.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Estado inicial de EVOL_MED no configurado.",
        });
      }
      const estadoInicialId = estadoInicialRows[0]!.id;

      // Crear instancia de documento en estado inicial
      const instanciaRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ece.documento_instancia
          (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
        SELECT
          ${tipoDocumentoId}::uuid,
          ea.id,
          ea.paciente_id,
          ${estadoInicialId}::uuid,
          ${personalId}::uuid
        FROM ece.episodio_atencion ea
        WHERE ea.id = ${input.episodioId}::uuid
        RETURNING id::text
      `;
      if (instanciaRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Episodio de atención no encontrado." });
      }
      const instanciaId = instanciaRows[0]!.id;

      // Serializar data JSONB (signosVitalesId si viene de D-1)
      const dataJson = input.data ? JSON.stringify(input.data) : null;

      // Crear la evolución médica
      const evolucionRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ece.evolucion_medica
          (instancia_id, episodio_id, fecha_hora, subjetivo, objetivo, analisis, plan, registrado_por, data)
        VALUES (
          ${instanciaId}::uuid,
          ${input.episodioId}::uuid,
          ${input.fecha}::timestamptz,
          ${input.soapSubjetivo ?? null},
          ${input.soapObjetivo ?? null},
          ${input.soapAnalisis ?? null},
          ${input.soapPlan ?? null},
          ${personalId}::uuid,
          ${dataJson}::jsonb
        )
        RETURNING id::text
      `;

      return { id: evolucionRows[0]!.id, instanciaId };
    });
  }),

  update: physicianProc.input(eceEvolucionUpdateSchema).mutation(async ({ ctx, input }) => {
    return withEceContext(ctx.prisma, ctx, async (tx) => {
      // Verificar existencia y obtener instancia_id + estado + autor
      const rows = await tx.$queryRaw<{
        instancia_id: string;
        registrado_por: string;
        estado_codigo: string;
      }[]>`
        SELECT
          em.instancia_id::text,
          em.registrado_por::text,
          fe.codigo AS estado_codigo
        FROM ece.evolucion_medica em
        JOIN ece.documento_instancia di ON di.id = em.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE em.id = ${input.id}::uuid
        LIMIT 1
      `;
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Evolución médica no encontrada." });
      }
      const evol = rows[0]!;

      if (evol.estado_codigo !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `No se puede editar una evolución en estado '${evol.estado_codigo}'. Solo se permiten ediciones en borrador.`,
        });
      }

      // Resolver personal_id del usuario para comparar con registrado_por
      const personalRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM ece.personal_salud
        WHERE his_user_id = ${ctx.user.id}::uuid AND activo = true
        LIMIT 1
      `;
      if (personalRows.length === 0 || personalRows[0]!.id !== evol.registrado_por) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo el autor puede editar la evolución." });
      }

      // COALESCE preserva el valor actual cuando el campo no se provee en el input.
      const dataJson = input.data !== undefined ? JSON.stringify(input.data) : null;
      await tx.$executeRaw`
        UPDATE ece.evolucion_medica
        SET
          subjetivo = COALESCE(${input.soapSubjetivo ?? null}, subjetivo),
          objetivo  = COALESCE(${input.soapObjetivo ?? null}, objetivo),
          analisis  = COALESCE(${input.soapAnalisis ?? null}, analisis),
          plan      = COALESCE(${input.soapPlan ?? null}, plan),
          data      = COALESCE(${dataJson}::jsonb, data)
        WHERE id = ${input.id}::uuid
      `;

      return { ok: true as const };
    });
  }),

  firmar: physicianProc
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withEceContext(ctx.prisma, ctx, async (tx) => {
        // Leer evolución + instancia + estado
        const rows = await tx.$queryRaw<{
          instancia_id: string;
          episodio_id: string;
          registrado_por: string;
          estado_codigo: string;
          subjetivo: string | null;
          objetivo: string | null;
          analisis: string | null;
          plan: string | null;
          data_text: string | null;
        }[]>`
          SELECT
            em.instancia_id::text,
            em.episodio_id::text,
            em.registrado_por::text,
            fe.codigo AS estado_codigo,
            em.subjetivo,
            em.objetivo,
            em.analisis,
            em.plan,
            em.data::text AS data_text
          FROM ece.evolucion_medica em
          JOIN ece.documento_instancia di ON di.id = em.instancia_id
          JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
          WHERE em.id = ${input.id}::uuid
          LIMIT 1
        `;
        if (rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Evolución médica no encontrada." });
        }
        const evol = rows[0]!;

        if (!["borrador", "en_revision"].includes(evol.estado_codigo)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `No se puede firmar una evolución en estado '${evol.estado_codigo}'.`,
          });
        }

        // Resolver personal_id del usuario firmante
        const personalRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM ece.personal_salud
          WHERE his_user_id = ${ctx.user.id}::uuid AND activo = true
          LIMIT 1
        `;
        if (personalRows.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "El usuario no tiene un perfil de personal de salud activo en ECE.",
          });
        }
        const personalId = personalRows[0]!.id;

        // Avanzar estado → firmado
        await avanzarEstado(tx, evol.instancia_id, "firmado", personalId, "firmar");

        // Calcular hash del contenido SOAP+data para el evento outbox.
        // data_text cubre problemas[]/plan[] estructurados del CC-0006.
        const soapContent = [evol.subjetivo, evol.objetivo, evol.analisis, evol.plan, evol.data_text]
          .map((v) => v ?? "")
          .join("|");
        const contentHash = createHash("sha256").update(soapContent, "utf8").digest("hex");

        const firmadaEn = new Date().toISOString();

        // Emitir evento outbox (mismo tx → atómico)
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.evolucion.firmada",
          aggregateType: "EvolucionMedica",
          aggregateId: input.id,
          emittedById: ctx.user.id,
          payload: {
            evolucionId: input.id,
            episodioId: evol.episodio_id,
            firmadaPor: personalId,
            contentHash,
            firmadaEn,
          },
        });

        return { ok: true as const, contentHash, firmadaEn };
      });
    }),

  validar: physicianProc
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withEceContext(ctx.prisma, ctx, async (tx) => {
        const rows = await tx.$queryRaw<{
          instancia_id: string;
          estado_codigo: string;
        }[]>`
          SELECT
            em.instancia_id::text,
            fe.codigo AS estado_codigo
          FROM ece.evolucion_medica em
          JOIN ece.documento_instancia di ON di.id = em.instancia_id
          JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
          WHERE em.id = ${input.id}::uuid
          LIMIT 1
        `;
        if (rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Evolución médica no encontrada." });
        }
        const evol = rows[0]!;

        if (evol.estado_codigo !== "firmado") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Solo se puede validar una evolución en estado 'firmado'. Estado actual: '${evol.estado_codigo}'.`,
          });
        }

        const personalRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM ece.personal_salud
          WHERE his_user_id = ${ctx.user.id}::uuid AND activo = true
          LIMIT 1
        `;
        if (personalRows.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "El usuario no tiene un perfil de personal de salud activo en ECE.",
          });
        }
        const personalId = personalRows[0]!.id;

        await avanzarEstado(tx, evol.instancia_id, "validado", personalId, "validar");

        return { ok: true as const };
      });
    }),
});
