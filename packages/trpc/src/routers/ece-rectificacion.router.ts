/**
 * Router tRPC — ECE Rectificaciones (NTEC Art. 41 / Art. 42).
 *
 * Modelo de datos (DDL real — ver sql/166_solicitud_arco_rectificacion_campos.sql):
 *
 *   ece.solicitud_arco  — tabla de ESTADO del flujo ARCO.
 *     Columnas clave para RECTIFICACION:
 *       id, tipo='RECTIFICACION', estado (PENDIENTE/APROBADA/RECHAZADA/EJECUTADA),
 *       documento_instancia_id, solicitante_id, campo, valor_anterior, valor_propuesto,
 *       motivo, revisado_por_id, fecha_respuesta, motivo_respuesta,
 *       creado_en, actualizado_en
 *
 *   ece.rectificacion   — registro INMUTABLE append-only (solo se inserta al APROBAR).
 *     Columnas: id, documento_original_id, tabla_origen, motivo, usuario_id (→personal_salud),
 *               hash_original, campo, valor_anterior, valor_nuevo, establecimiento_id, creado_en
 *
 * Procedures:
 *   eceRectificacion.list      — lista por documentoInstanciaId (PHYSICIAN/NURSE/DIR)
 *   eceRectificacion.solicitar — crea solicitud_arco PENDIENTE (PHYSICIAN/NURSE)
 *   eceRectificacion.aprobar   — APROBADA + INSERT ece.rectificacion + domainEvent (DIR)
 *   eceRectificacion.rechazar  — RECHAZADA + domainEvent (DIR)
 *   eceRectificacion.firmar    — EJECUTADA / cierre por autor (PHYSICIAN/NURSE)
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { emitDomainEvent } from "@his/database";
import { requireRole, router } from "../trpc";
import { requireEcePermission } from "../middleware/ece-permission";

// ---------------------------------------------------------------------------
// Schemas de input (contratos públicos — NO cambiar sin migrar la UI)
// ---------------------------------------------------------------------------

const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, { message: "PIN debe ser 6-8 dígitos." });

const listInput = z
  .object({
    documentoInstanciaId: z.string().uuid().optional(),
    episodioId: z.string().uuid().optional(),
    estado: z
      .enum(["PENDIENTE", "APROBADA", "RECHAZADA", "FIRMADA"])
      .optional(),
  })
  .refine((v) => v.documentoInstanciaId ?? v.episodioId, {
    message: "Se requiere documentoInstanciaId o episodioId.",
  });

const solicitarInput = z.object({
  documentoInstanciaId: z.string().uuid(),
  campo: z.string().min(1).max(200),
  valorAnterior: z.string().min(1).max(2000),
  valorPropuesto: z.string().min(1).max(2000),
  motivo: z.string().min(10).max(1000),
});

const aprobarInput = z.object({
  rectificacionId: z.string().uuid(),
  pin: pinSchema,
});

const rechazarInput = z.object({
  rectificacionId: z.string().uuid(),
  motivoRechazo: z.string().min(10).max(500),
  pin: pinSchema,
});

const firmarInput = z.object({
  rectificacionId: z.string().uuid(),
  pin: pinSchema,
});

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * Shape que devuelven las queries sobre solicitud_arco para el contrato UI.
 * La UI espera los nombres de columna snake_case listados en RectificacionRow.
 *
 * Nota: solicitud_arco.motivo_respuesta se expone como motivo_rechazo.
 * solicitud_arco.fecha_respuesta se expone como fecha_aprobacion.
 * solicitud_arco.revisado_por_id se expone como aprobador_id.
 * El campo "firmado_en" no existe en la BD — se omite o se fija null.
 */
type RectificacionRow = {
  id: string;
  documento_instancia_id: string;
  campo: string;
  valor_anterior: string;
  valor_propuesto: string;
  motivo: string;
  // La UI admite "FIRMADA" como estado de display; en BD es "EJECUTADA".
  // Mapeamos EJECUTADA→FIRMADA en SQL para mantener el contrato UI intacto.
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "FIRMADA";
  solicitante_id: string;
  solicitante_nombre: string | null;
  aprobador_id: string | null;
  fecha_aprobacion: string | null;
  motivo_rechazo: string | null;
  created_at: string;
};

type FirmaRow = {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
};

type SolicitudRow = {
  id: string;
  estado: string;
  documento_instancia_id: string | null;
  solicitante_id: string | null;
  campo: string | null;
  valor_anterior: string | null;
  valor_propuesto: string | null;
  motivo: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadFirmaDir(
  prisma: {
    $queryRaw: (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown>;
  },
  userId: string,
): Promise<FirmaRow> {
  const personal = await (
    prisma.$queryRaw as (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<Array<{ id: string }>>
  )`
    SELECT id FROM ece.personal_salud
    WHERE his_user_id = ${userId}::uuid AND activo = true
    LIMIT 1
  `;
  if (!personal[0]) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se encontró personal ECE asociado a su cuenta.",
    });
  }

  const firmas = await (
    prisma.$queryRaw as (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<FirmaRow[]>
  )`
    SELECT id, pin_hash, failed_attempts, locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personal[0].id}::uuid
    LIMIT 1
  `;
  if (!firmas[0]) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Firma electrónica no configurada. Use firma.setup.",
    });
  }
  return firmas[0];
}

async function checkPinDir(firma: FirmaRow, pin: string): Promise<void> {
  if (firma.revoked_at !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "La firma electrónica del DIR ha sido revocada.",
    });
  }
  if (firma.locked_until !== null && firma.locked_until > new Date()) {
    const mins = Math.ceil((firma.locked_until.getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada. Inténtelo en ${mins} min.`,
    });
  }
  const { argon2 } = await import("@his/infrastructure");
  const valid = await argon2.verify(firma.pin_hash, pin);
  if (!valid) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "PIN de firma incorrecto.",
    });
  }
}

async function findSolicitud(
  prisma: {
    $queryRaw: (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown>;
  },
  id: string,
): Promise<SolicitudRow | null> {
  const rows = await (
    prisma.$queryRaw as (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<SolicitudRow[]>
  )`
    SELECT id, estado, documento_instancia_id, solicitante_id,
           campo, valor_anterior, valor_propuesto, motivo
    FROM ece.solicitud_arco
    WHERE id = ${id}::uuid AND tipo = 'RECTIFICACION'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eceRectificacionRouter = router({
  /**
   * Lista solicitudes de rectificación por documentoInstanciaId (o episodioId).
   * Mapea columnas solicitud_arco → shape RectificacionRow esperado por la UI.
   *
   * El campo "EJECUTADA" (estado BD) se expone como "FIRMADA" para que el
   * componente EstadoBadge de la UI lo reconozca.
   */
  list: requireRole(["PHYSICIAN", "NURSE", "DIR"])
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const estadoFilter = input.estado
        // UI manda "FIRMADA" pero en BD el valor es "EJECUTADA"
        ? input.estado === "FIRMADA" ? "EJECUTADA" : input.estado
        : null;
      const instanciaFilter = input.documentoInstanciaId ?? null;
      const episodioFilter = input.episodioId ?? null;

      return (
        ctx.prisma.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<RectificacionRow[]>
      )`
        SELECT
          sa.id,
          sa.documento_instancia_id,
          sa.campo,
          sa.valor_anterior,
          sa.valor_propuesto,
          sa.motivo,
          CASE sa.estado
            WHEN 'EJECUTADA' THEN 'FIRMADA'
            ELSE sa.estado
          END AS estado,
          sa.solicitante_id,
          u."fullName" AS solicitante_nombre,
          sa.revisado_por_id  AS aprobador_id,
          sa.fecha_respuesta::text AS fecha_aprobacion,
          sa.motivo_respuesta AS motivo_rechazo,
          sa.creado_en::text AS created_at
        FROM ece.solicitud_arco sa
        LEFT JOIN public."User" u ON u.id = sa.solicitante_id
        LEFT JOIN ece.documento_instancia di ON di.id = sa.documento_instancia_id
        WHERE sa.tipo = 'RECTIFICACION'
          AND (${instanciaFilter}::uuid IS NULL OR sa.documento_instancia_id = ${instanciaFilter}::uuid)
          AND (${episodioFilter}::uuid IS NULL OR di.episodio_id = ${episodioFilter}::uuid)
          AND (${estadoFilter}::text IS NULL OR sa.estado = ${estadoFilter}::text)
        ORDER BY sa.creado_en DESC
      `;
    }),

  /**
   * Crea una solicitud de rectificación sobre un documento firmado.
   * NTEC Art. 41: el documento original no se modifica.
   *
   * Verifica que el documento esté en estado firmado/validado/certificado
   * consultando el estado actual vía estado_actual_id → flujo_estado.
   */
  solicitar: requireRole(["PHYSICIAN", "NURSE"])
    .input(solicitarInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenant) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Contexto de organización requerido." });
      }
      const orgId = ctx.tenant.organizationId;

      // Verificar que el documento exista y esté en un estado "firmado" (NTEC Art. 41).
      const docRows = await (
        ctx.prisma.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string; paciente_public_id: string | null; estado_codigo: string }>>
      )`
        SELECT di.id, p.public_patient_id::text AS paciente_public_id, fe.codigo AS estado_codigo
        FROM ece.documento_instancia di
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        LEFT JOIN ece.paciente p ON p.id = di.paciente_id
        WHERE di.id = ${input.documentoInstanciaId}::uuid
        LIMIT 1
      `;

      if (!docRows[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento no encontrado.",
        });
      }

      const estadoFirmados = ["firmado", "validado", "certificado"];
      if (!estadoFirmados.includes(docRows[0].estado_codigo)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Solo se pueden rectificar documentos con estado firmado, validado o certificado.",
        });
      }

      // solicitud_arco.paciente_id es FK a public."Patient".id (NO a ece.paciente.id).
      const pacienteId = docRows[0].paciente_public_id;
      if (!pacienteId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El paciente del documento no está vinculado al MPI público.",
        });
      }

      const newRows = await (
        ctx.prisma.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>
      )`
        INSERT INTO ece.solicitud_arco
          (tipo, estado, documento_instancia_id, solicitante_id,
           campo, valor_anterior, valor_propuesto, motivo,
           organizacion_id, paciente_id)
        VALUES
          ('RECTIFICACION', 'PENDIENTE',
           ${input.documentoInstanciaId}::uuid,
           ${ctx.user.id}::uuid,
           ${input.campo}, ${input.valorAnterior}, ${input.valorPropuesto}, ${input.motivo},
           ${orgId}::uuid, ${pacienteId}::uuid)
        RETURNING id
      `;

      const solicitudId = newRows[0]?.id;
      if (!solicitudId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Error al crear la solicitud de rectificación.",
        });
      }

      return { id: solicitudId };
    }),

  /**
   * DIR aprueba una solicitud PENDIENTE.
   * NTEC Art. 42: requiere PIN argon2id.
   * Al aprobar: estado→APROBADA + INSERT inmutable en ece.rectificacion.
   */
  aprobar: requireEcePermission("ece.rectificacion.aprobar")
    .input(aprobarInput)
    .mutation(async ({ ctx, input }) => {
      const firma = await loadFirmaDir(ctx.prisma, ctx.user.id);
      await checkPinDir(firma, input.pin);

      const solicitud = await findSolicitud(ctx.prisma, input.rectificacionId);

      if (!solicitud) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de rectificación no encontrada.",
        });
      }

      if (solicitud.estado !== "PENDIENTE") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La solicitud ya fue ${solicitud.estado.toLowerCase()}.`,
        });
      }

      // Resolver personal_salud del aprobador para insertar en ece.rectificacion.
      const personalRows = await (
        ctx.prisma.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ id: string }>>
      )`
        SELECT id FROM ece.personal_salud
        WHERE his_user_id = ${ctx.user.id}::uuid AND activo = true
        LIMIT 1
      `;
      const personalId = personalRows[0]?.id ?? null;

      // hash_original: SHA-256 del motivo + campo + valor_anterior (contenido de la solicitud).
      // Sirve como huella del contexto al momento de la aprobación.
      const hashContent = JSON.stringify({
        solicitudId: solicitud.id,
        campo: solicitud.campo,
        valor_anterior: solicitud.valor_anterior,
        motivo: solicitud.motivo,
      });
      const hashOriginal = createHash("sha256").update(hashContent).digest("hex");

      // Transacción: UPDATE estado + INSERT registro inmutable.
      await (
        ctx.prisma.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>
      )`
        UPDATE ece.solicitud_arco
        SET estado          = 'APROBADA',
            revisado_por_id = ${ctx.user.id}::uuid,
            fecha_respuesta = now(),
            actualizado_en  = now()
        WHERE id = ${input.rectificacionId}::uuid
      `;

      // Registro inmutable NTEC: solo se inserta si tenemos personal_salud resuelto.
      if (personalId && solicitud.documento_instancia_id) {
        await (
          ctx.prisma.$executeRaw as (
            query: TemplateStringsArray,
            ...values: unknown[]
          ) => Promise<number>
        )`
          INSERT INTO ece.rectificacion
            (documento_original_id, tabla_origen, motivo,
             usuario_id, hash_original, campo, valor_anterior, valor_nuevo)
          VALUES
            (${solicitud.documento_instancia_id}::uuid,
             'ece.documento_instancia',
             ${solicitud.motivo},
             ${personalId}::uuid,
             ${hashOriginal},
             ${solicitud.campo},
             ${solicitud.valor_anterior},
             ${solicitud.valor_propuesto})
        `;
      }

      // Emitir evento de dominio (reemplaza insertOutbox que usaba public.outbox inexistente).
      if (ctx.tenant && solicitud.documento_instancia_id && solicitud.solicitante_id) {
        await emitDomainEvent(ctx.prisma, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.rectificacion.aprobada",
          aggregateType: "SolicitudArco",
          aggregateId: input.rectificacionId,
          emittedById: ctx.user.id,
          payload: {
            rectificacionId: input.rectificacionId,
            documentoInstanciaId: solicitud.documento_instancia_id,
            solicitanteId: solicitud.solicitante_id,
            aprobadorId: ctx.user.id,
          },
        });
      }

      return { ok: true as const };
    }),

  /**
   * DIR rechaza una solicitud PENDIENTE con motivo obligatorio.
   * NTEC Art. 42: requiere PIN argon2id.
   */
  rechazar: requireEcePermission("ece.rectificacion.aprobar")
    .input(rechazarInput)
    .mutation(async ({ ctx, input }) => {
      const firma = await loadFirmaDir(ctx.prisma, ctx.user.id);
      await checkPinDir(firma, input.pin);

      const solicitud = await findSolicitud(ctx.prisma, input.rectificacionId);

      if (!solicitud) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de rectificación no encontrada.",
        });
      }

      if (solicitud.estado !== "PENDIENTE") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La solicitud ya fue ${solicitud.estado.toLowerCase()}.`,
        });
      }

      await (
        ctx.prisma.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>
      )`
        UPDATE ece.solicitud_arco
        SET estado           = 'RECHAZADA',
            revisado_por_id  = ${ctx.user.id}::uuid,
            fecha_respuesta  = now(),
            motivo_respuesta = ${input.motivoRechazo},
            actualizado_en   = now()
        WHERE id = ${input.rectificacionId}::uuid
      `;

      if (ctx.tenant && solicitud.documento_instancia_id && solicitud.solicitante_id) {
        await emitDomainEvent(ctx.prisma, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.rectificacion.rechazada",
          aggregateType: "SolicitudArco",
          aggregateId: input.rectificacionId,
          emittedById: ctx.user.id,
          payload: {
            rectificacionId: input.rectificacionId,
            documentoInstanciaId: solicitud.documento_instancia_id,
            solicitanteId: solicitud.solicitante_id,
            rechazadoPorId: ctx.user.id,
            motivoRechazo: input.motivoRechazo,
          },
        });
      }

      return { ok: true as const };
    }),

  /**
   * El autor original cierra la solicitud aprobada (EJECUTADA en BD = FIRMADA en UI).
   * NTEC Art. 42: la firma del autor cierra el ciclo.
   */
  firmar: requireRole(["PHYSICIAN", "NURSE"])
    .input(firmarInput)
    .mutation(async ({ ctx, input }) => {
      const firma = await loadFirmaDir(ctx.prisma, ctx.user.id);
      await checkPinDir(firma, input.pin);

      const solicitud = await findSolicitud(ctx.prisma, input.rectificacionId);

      if (!solicitud) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitud de rectificación no encontrada.",
        });
      }

      if (solicitud.estado !== "PENDIENTE" && solicitud.estado !== "APROBADA") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La solicitud no puede firmarse desde el estado ${solicitud.estado}.`,
        });
      }

      if (solicitud.solicitante_id !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el autor que solicitó la rectificación puede firmarla.",
        });
      }

      const firmadoEn = new Date().toISOString();

      await (
        ctx.prisma.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>
      )`
        UPDATE ece.solicitud_arco
        SET estado         = 'EJECUTADA',
            actualizado_en = now()
        WHERE id = ${input.rectificacionId}::uuid
      `;

      return { ok: true as const, firmadoEn };
    }),
});
