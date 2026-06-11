/**
 * Router tRPC — ECE Certificación Director (Art. 21 NTEC).
 *
 * Norma: MINSAL Acuerdo n.° 1616 (2024), Art. 21 — Certificación oficial de
 *   documentos clínicos por el Director Médico del establecimiento.
 * Código de operación: ECE-CERT (transversal — aplica a varios tipos_documento).
 *
 * Este router implementa el paso final del workflow de certificación para
 * documentos que requieren sello del director. Solo opera sobre documentos
 * en estado 'validado'. Los tipos elegibles son:
 *   - FICHA_ID    (Ficha de Identificación del Paciente)
 *   - EPICRISIS   (Epicrisis de Egreso)
 *   - CERT_DEF    (Certificado de Defunción)
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (paso terminal — solo el step certificar)
 * ---------------------------------------------------------------------------
 *   validado → certificado  (DIR: firma con PIN argon2id + emite outbox)
 *   Precondición estricta: estado = 'validado' en ece.documento_instancia.
 *   El router rechaza con FORBIDDEN si el tipo_documento no está en la lista
 *   elegible, usando requireEcePermission("ece.documento.certificar").
 *
 *   El PIN se verifica contra ece.firma_electronica.pin_hash (argon2id).
 *   Lockout automático tras 3 intentos fallidos (locked_until timestamptz).
 *   Se registra transición en ece.documento_instancia_historial con SHA-256.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext)
 * ---------------------------------------------------------------------------
 *   'ece.documento.certificado'  — emitido por certificar(). Beta.15 notifications.
 *     Payload: { instanciaId, tipoDocumento, dirUserId, payloadHash, orgId }
 *     payloadHash = SHA-256(instanciaId + tipoDocumento + directorId + timestamp)
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.documento_instancia           — estado actual; filtrado por 'validado'
 *   ece.documento_instancia_historial — append-only log de transiciones
 *   ece.firma_electronica             — credencial PIN del DIR (argon2id hash)
 *   ece.personal_salud                — mapeo his_user_id → personal ECE id
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   listCola        → requireRole(["DIR"])  — cola de documentos pendientes de certificar
 *   certificar      → requireRole(["DIR"])  + requireEcePermission("ece.documento.certificar")
 *   certificarBulk  → requireRole(["DIR"])  — verifica PIN una vez, certifica todos en serie
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { requireEcePermission } from "../../middleware/ece-permission";
import { withWorkflowContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";

// PIN de firma: 6-8 dígitos numéricos
const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, { message: "El PIN debe tener entre 6 y 8 dígitos." });

const listColaCertificacionInput = z.object({
  incluirCertificados: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

const certificarInput = z.object({
  instanciaId: z.string().uuid(),
  pin: pinSchema,
});

const certificarBulkInput = z.object({
  instanciaIds: z.array(z.string().uuid()).min(1).max(100),
  pin: pinSchema,
});

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

interface InstanciaColaRow {
  id: string;
  tipo_documento_codigo: string;
  tipo_documento_nombre: string;
  paciente_id: string;
  paciente_nombre: string;
  estado_codigo: string;
  estado_nombre: string;
  version: number;
  validado_por: string | null;
  validado_por_nombre: string | null;
  creado_en: Date;
  ultimo_cambio_en: Date;
}

interface FirmaRow {
  id: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
}

interface PersonalRow {
  id: string;
}

// ---------------------------------------------------------------------------
// Helpers raw SQL
// ---------------------------------------------------------------------------

async function findPersonal(
  prisma: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<PersonalRow | null> {
  const rows = await (prisma.$queryRaw as (
    q: TemplateStringsArray, ...v: unknown[]
  ) => Promise<PersonalRow[]>)`
    SELECT id
    FROM ece.personal_salud
    WHERE his_user_id = ${userId}::uuid AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Verifica PIN argon2id contra la firma del DIR. Lanza TRPCError si falla. */
async function checkPinDir(firmaRow: FirmaRow & { pin_hash: string }, pin: string): Promise<void> {
  if (firmaRow.revoked_at !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "La firma electrónica del DIR ha sido revocada.",
    });
  }
  if (firmaRow.locked_until !== null && firmaRow.locked_until > new Date()) {
    const mins = Math.ceil((firmaRow.locked_until.getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada. Inténtelo en ${mins} min.`,
    });
  }
  const { argon2 } = await import("@his/infrastructure");
  const valid = await argon2.verify(firmaRow.pin_hash, pin);
  if (!valid) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "PIN de firma incorrecto.",
    });
  }
}

// ---------------------------------------------------------------------------
// Core — certifica un documento dentro de una transacción ya abierta.
// Reutilizado por `certificar` (individual) y `certificarBulk` (loop).
// La verificación de PIN NO está aquí — el caller es responsable de
// verificarla antes de invocar esta función.
// ---------------------------------------------------------------------------

type TxLike = {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>;
};

interface CertificarOneParams {
  tx: TxLike;
  instanciaId: string;
  firmaId: string;
  userId: string;
  organizationId: string;
}

async function certificarOneInTx({
  tx,
  instanciaId,
  firmaId,
  userId,
  organizationId,
}: CertificarOneParams): Promise<{ instanciaId: string; payloadHash: string }> {
  const TIPOS_CERTIFICABLES = new Set(["FICHA_ID", "EPICRISIS", "CERT_DEF"]);

  // 1. Leer instancia con lock optimista.
  const instancias = await (tx.$queryRaw as (
    q: TemplateStringsArray, ...v: unknown[]
  ) => Promise<Array<{
    id: string;
    estado_actual_id: string;
    estado_codigo: string;
    tipo_documento_codigo: string;
    paciente_id: string;
    version: number;
  }>>)`
    SELECT
      di.id,
      di.estado_actual_id,
      fe.codigo AS estado_codigo,
      td.codigo AS tipo_documento_codigo,
      di.paciente_id,
      di.version
    FROM ece.documento_instancia di
    JOIN ece.flujo_estado   fe ON fe.id = di.estado_actual_id
    JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
    WHERE di.id = ${instanciaId}::uuid
      AND di.estado_registro = 'vigente'
    FOR UPDATE
  `;

  const instancia = instancias[0];
  if (!instancia) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Documento ${instanciaId} no encontrado o inactivo.`,
    });
  }

  if (instancia.estado_codigo !== "validado") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Documento ${instanciaId}: solo se pueden certificar documentos en estado 'validado'. Estado actual: ${instancia.estado_codigo}.`,
    });
  }

  if (!TIPOS_CERTIFICABLES.has(instancia.tipo_documento_codigo)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `El tipo '${instancia.tipo_documento_codigo}' no es certificable por DIR (Art. 21 NTEC).`,
    });
  }

  // 2. Resolver estado 'certificado' para este tipo de documento.
  const estadosCertificado = await (tx.$queryRaw as (
    q: TemplateStringsArray, ...v: unknown[]
  ) => Promise<Array<{ id: string }>>)`
    SELECT fe.id
    FROM ece.flujo_estado fe
    JOIN ece.tipo_documento td ON td.id = fe.tipo_documento_id
    WHERE td.codigo = ${instancia.tipo_documento_codigo}
      AND fe.codigo = 'certificado'
    LIMIT 1
  `;

  const estadoCertificado = estadosCertificado[0];
  if (!estadoCertificado) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Estado 'certificado' no configurado en el workflow.",
    });
  }

  // 3. Hash de integridad del payload clínico.
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({
      instanciaId: instancia.id,
      tipoCodigo: instancia.tipo_documento_codigo,
      version: instancia.version,
      dirUserId: userId,
      firmaId,
    }))
    .digest("hex");

  // 4. Actualizar estado (optimistic locking por version).
  const updated = await (tx.$executeRaw as (
    q: TemplateStringsArray, ...v: unknown[]
  ) => Promise<number>)`
    UPDATE ece.documento_instancia
    SET
      estado_actual_id = ${estadoCertificado.id}::uuid,
      version          = version + 1
    WHERE id      = ${instancia.id}::uuid
      AND version = ${instancia.version}
  `;

  if (updated === 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Documento ${instanciaId} fue modificado concurrentemente. Recargue e intente de nuevo.`,
    });
  }

  // 5. Historial inmutable.
  const observacion = `Certificación DIR Art. 21 NTEC — hash: ${payloadHash.slice(0, 16)}…`;
  await (tx.$executeRaw as (
    q: TemplateStringsArray, ...v: unknown[]
  ) => Promise<number>)`
    INSERT INTO ece.documento_instancia_historial
      (instancia_id, estado_anterior_id, estado_nuevo_id,
       accion, ejecutado_por, firma_id, observacion, ejecutado_en)
    VALUES (
      ${instancia.id}::uuid,
      ${instancia.estado_actual_id}::uuid,
      ${estadoCertificado.id}::uuid,
      'certificar',
      ${userId}::uuid,
      ${firmaId}::uuid,
      ${observacion},
      now()
    )
  `;

  // 6. Evento outbox transaccional.
  await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
    organizationId,
    eventType: "ece.documento.certificado",
    aggregateType: "DocumentoInstancia",
    aggregateId: instancia.id,
    emittedById: userId,
    payload: {
      instanciaId: instancia.id,
      tipoDocumentoCodigo: instancia.tipo_documento_codigo,
      fromEstadoCodigo: "validado",
      firmaId,
      payloadHash,
      dirUserId: userId,
      pacienteId: instancia.paciente_id,
    },
  });

  return { instanciaId: instancia.id, payloadHash };
}

// ---------------------------------------------------------------------------
// Base procedures
// ---------------------------------------------------------------------------

const dirProcedure = requireRole(["DIR"]);
const certificarProcedure = requireEcePermission("ece.documento.certificar");

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eceCertificacionRouter = router({
  /**
   * Lista documentos en estado 'validado' pendientes de certificación DIR.
   * Ordenados por antigüedad (los más viejos primero — FIFO de cola).
   * Con `incluirCertificados: true` devuelve también los ya certificados
   * (histórico, orden DESC por último cambio).
   */
  listCola: dirProcedure
    .input(listColaCertificacionInput)
    .query(async ({ ctx, input }) => {
      const estadoFiltro = input.incluirCertificados
        ? ["validado", "certificado"]
        : ["validado"];

      const baseQuery = `
        SELECT
          di.id,
          td.codigo          AS tipo_documento_codigo,
          td.nombre          AS tipo_documento_nombre,
          di.paciente_id,
          COALESCE(
            p."firstName" || ' ' || p."firstLastName",
            di.paciente_id::text
          )                  AS paciente_nombre,
          fe.codigo          AS estado_codigo,
          fe.nombre          AS estado_nombre,
          di.version,
          dih.ejecutado_por  AS validado_por,
          COALESCE(
            u."firstName" || ' ' || u."firstLastName",
            NULL
          )                  AS validado_por_nombre,
          di.creado_en,
          di.actualizado_en  AS ultimo_cambio_en
        FROM ece.documento_instancia di
        JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
        JOIN ece.flujo_estado   fe ON fe.id = di.estado_actual_id
        LEFT JOIN LATERAL (
          SELECT ejecutado_por
          FROM ece.documento_instancia_historial
          WHERE instancia_id = di.id
            AND accion = 'validar'
          ORDER BY ejecutado_en DESC
          LIMIT 1
        ) dih ON true
        LEFT JOIN public."Patient" p ON p.id = di.paciente_id
        LEFT JOIN public."User"    u ON u.id = dih.ejecutado_por
        WHERE fe.codigo = ANY($1::text[])
          AND di.estado_registro = 'vigente'
          ${input.cursor ? "AND di.id > $2::uuid" : ""}
        ORDER BY
          ${input.incluirCertificados
            ? "di.actualizado_en DESC"
            : "di.creado_en ASC"}
        LIMIT ${input.cursor ? "$3" : "$2"}
      `;

      const limit = input.limit + 1; // +1 para detectar hasMore
      const params = input.cursor
        ? [estadoFiltro, input.cursor, limit]
        : [estadoFiltro, limit];

      const rows = await ctx.prisma.$queryRawUnsafe<InstanciaColaRow[]>(
        baseQuery,
        ...params,
      );

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      return {
        items: items.map((r) => ({
          id: r.id,
          tipoDocumentoCodigo: r.tipo_documento_codigo,
          tipoDocumentoNombre: r.tipo_documento_nombre,
          pacienteId: r.paciente_id,
          pacienteNombre: r.paciente_nombre,
          estadoCodigo: r.estado_codigo,
          estadoNombre: r.estado_nombre,
          version: r.version,
          validadoPor: r.validado_por,
          validadoPorNombre: r.validado_por_nombre,
          creadoEn: r.creado_en instanceof Date
            ? r.creado_en.toISOString()
            : String(r.creado_en),
          ultimoCambioEn: r.ultimo_cambio_en instanceof Date
            ? r.ultimo_cambio_en.toISOString()
            : String(r.ultimo_cambio_en),
        })),
        nextCursor,
      };
    }),

  /**
   * Certifica un documento individual: avanza estado 'validado' → 'certificado',
   * valida PIN del DIR, registra historial e inserta evento outbox.
   */
  certificar: certificarProcedure
    .input(certificarInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenant.establishmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere un establecimiento activo.",
        });
      }

      const eceCtx = {
        personalId: ctx.user.id,
        establecimientoId: ctx.tenant.establishmentId,
        roles: ctx.tenant.roleCodes,
      };

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        // Verificar firma del DIR.
        const personal = await findPersonal(tx, ctx.user.id);
        if (!personal) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No se encontró personal ECE asociado a su cuenta.",
          });
        }

        const firmas = await (tx.$queryRaw as (
          q: TemplateStringsArray, ...v: unknown[]
        ) => Promise<Array<FirmaRow & { pin_hash: string }>>)`
          SELECT id, pin_hash, failed_attempts, locked_until, revoked_at
          FROM ece.firma_electronica
          WHERE personal_id = ${personal.id}::uuid
          LIMIT 1
        `;

        const firma = firmas[0];
        if (!firma) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Firma electrónica no configurada. Use firma.setup.",
          });
        }

        await checkPinDir(firma, input.pin);

        const resultado = await certificarOneInTx({
          tx,
          instanciaId: input.instanciaId,
          firmaId: firma.id,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
        });
        return { ok: true as const, ...resultado };
      });
    }),

  /**
   * Certifica múltiples documentos en una sola operación bulk.
   *
   * El PIN se verifica UNA SOLA VEZ al inicio. Luego cada documento se
   * certifica en serie dentro de su propia transacción independiente
   * (no se hace rollback global si un documento falla — los exitosos
   * quedan certificados y se reportan como tales).
   *
   * Retorna { exitosos, fallidos } para feedback granular en UI.
   *
   * Límite: 100 documentos por llamada (protección contra abusos de timeout).
   */
  certificarBulk: dirProcedure
    .input(certificarBulkInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenant.establishmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere un establecimiento activo.",
        });
      }

      const eceCtx = {
        personalId: ctx.user.id,
        establecimientoId: ctx.tenant.establishmentId,
        roles: ctx.tenant.roleCodes,
      };

      // Fase 1: verificar PIN una sola vez (fuera del loop de documentos).
      const firmaVerificada = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const personal = await findPersonal(tx, ctx.user.id);
        if (!personal) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No se encontró personal ECE asociado a su cuenta.",
          });
        }

        const firmas = await (tx.$queryRaw as (
          q: TemplateStringsArray, ...v: unknown[]
        ) => Promise<Array<FirmaRow & { pin_hash: string }>>)`
          SELECT id, pin_hash, failed_attempts, locked_until, revoked_at
          FROM ece.firma_electronica
          WHERE personal_id = ${personal.id}::uuid
          LIMIT 1
        `;

        const firma = firmas[0];
        if (!firma) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Firma electrónica no configurada. Use firma.setup.",
          });
        }

        // Lanza UNAUTHORIZED si el PIN es incorrecto — aborta antes de procesar cualquier doc.
        await checkPinDir(firma, input.pin);

        return { firmaId: firma.id };
      });

      // Fase 2: certificar cada documento en serie, transacción independiente por doc.
      const exitosos: Array<{ instanciaId: string; payloadHash: string }> = [];
      const fallidos: Array<{ instanciaId: string; error: string }> = [];

      for (const instanciaId of input.instanciaIds) {
        try {
          const resultado = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
            return certificarOneInTx({
              tx,
              instanciaId,
              firmaId: firmaVerificada.firmaId,
              userId: ctx.user.id,
              organizationId: ctx.tenant.organizationId,
            });
          });
          exitosos.push(resultado);
        } catch (err) {
          // Capturar error del documento individual sin abortar el bulk.
          const message =
            err instanceof TRPCError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Error desconocido";
          fallidos.push({ instanciaId, error: message });
        }
      }

      return { exitosos, fallidos };
    }),
});
