/**
 * Router tRPC — ECE Documentos Clínicos Asociados (DOC_ASOC).
 *
 * NTEC §15 (expediente clínico debe incluir documentos asociados)
 * NTEC §38 (referencias y contra-referencias — adjuntos).
 *
 * Propósito: gestionar metadata de archivos adjuntados al expediente
 * (imágenes, PDFs, DICOM externos). El archivo físico va a Supabase Storage
 * (bucket 'ece-documentos-asociados'); el cliente obtiene la URL firmada
 * vía Route Handler en /api/ece/documento-asociado/signed-url.
 *
 * Flujo:
 *   1. UI solicita upload URL → POST /api/ece/documento-asociado/signed-url
 *   2. UI sube el archivo directo a Storage con la URL firmada.
 *   3. UI llama eceDocAsoc.create con la metadata + storage_path.
 *   4. Post-create: firmar (PIN argon2), anular (DIR/ADMIN).
 *   5. UI solicita download URL → GET /api/ece/documento-asociado/signed-url?id=...
 *
 * Inmutabilidad post-firma: el trigger SQL trg_doc_asoc_inmutable bloquea
 * modificaciones de contenido/título/hash/storage_path en estado 'firmado'.
 */
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";
import { withWorkflowContext } from "../../workflow/context";
import type { EceContext } from "../../workflow/context";
import {
  documentoAsociadoCreateInput,
  documentoAsociadoFirmarInput,
  documentoAsociadoAnularInput,
  documentoAsociadoGetInput,
  documentoAsociadoListInput,
} from "@his/contracts/schemas/documento-asociado";

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

interface DocAsocRow {
  id: string;
  instancia_id: string;
  paciente_id: string;
  episodio_id: string | null;
  establecimiento_id: string;
  categoria: string;
  titulo: string;
  descripcion: string | null;
  fecha_documento: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  tamano_bytes: bigint;
  hash_sha256: string;
  adjuntado_por: string;
  adjuntado_en: Date;
  estado_registro: string;
  firmado_por: string | null;
  firmado_en: Date | null;
  motivo_anulacion: string | null;
  // virtual — JOIN con documento_instancia → flujo_estado
  estado_documento: string | null;
}

type RawTx = {
  $queryRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
  $executeRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Context helper
// ---------------------------------------------------------------------------

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}): EceContext {
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

// ---------------------------------------------------------------------------
// Helpers: personal + firma electrónica (patrón atencion-emergencia.router.ts)
// ---------------------------------------------------------------------------

interface PersonalRow { id: string }

interface FirmaRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  intentos_fallidos: number;
  locked_until: Date | null;
  bloqueado_hasta: Date | null;
  revoked_at: Date | null;
}

const LOCKOUT_MAX = 5;

async function findPersonal(tx: RawTx, hisUserId: string): Promise<PersonalRow | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<PersonalRow[]>)`
    SELECT id::text
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findFirma(tx: RawTx, personalId: string): Promise<FirmaRow | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<FirmaRow[]>)`
    SELECT id::text, pin_hash, failed_attempts, intentos_fallidos,
           locked_until, bloqueado_hasta, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function verifyPin(
  tx: RawTx,
  hisUserId: string,
  pin: string,
): Promise<{ firmaId: string; personalId: string }> {
  const personal = await findPersonal(tx, hisUserId);
  if (!personal) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Sin perfil de personal_salud activo.",
    });
  }

  const firma = await findFirma(tx, personal.id);
  if (!firma) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Firma electrónica no configurada para el usuario.",
    });
  }

  const bloqueadoHasta = firma.bloqueado_hasta ?? firma.locked_until;
  if (bloqueadoHasta && bloqueadoHasta > new Date()) {
    const mins = Math.ceil((bloqueadoHasta.getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada. Reintente en ${mins} min.`,
    });
  }

  const { argon2 } = await import("@his/infrastructure");
  const valid = await argon2.verify(firma.pin_hash, pin);

  if (!valid) {
    const intentosActuales = firma.intentos_fallidos ?? firma.failed_attempts;
    await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
      UPDATE ece.firma_electronica
      SET intentos_fallidos = intentos_fallidos + 1,
          failed_attempts   = failed_attempts + 1
      WHERE id = ${firma.id}::uuid
    `;
    const rem = LOCKOUT_MAX - (intentosActuales + 1);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: rem > 0
        ? `PIN incorrecto. Intentos restantes: ${rem}.`
        : "PIN incorrecto. Firma bloqueada.",
    });
  }

  await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
    UPDATE ece.firma_electronica
    SET intentos_fallidos = 0, failed_attempts = 0
    WHERE id = ${firma.id}::uuid
  `;

  return { firmaId: firma.id, personalId: personal.id };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const readerProc = requireRole(["MT", "PHYSICIAN", "NURSE", "DIR", "ADMIN"]);
const writerProc = requireRole(["MT", "PHYSICIAN", "NURSE"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const documentoAsociadoRouter = router({

  /** Lista documentos con filtros opcionales, paginado. */
  list: readerProc.input(documentoAsociadoListInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const pacienteFilter = input.pacienteId ?? null;
      const episodioFilter = input.episodioId ?? null;
      const categoriaFilter = input.categoria ?? null;
      const offset = (input.page - 1) * input.pageSize;

      const rows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<DocAsocRow[]>)`
        SELECT
          da.id::text, da.instancia_id::text, da.paciente_id::text,
          da.episodio_id::text, da.establecimiento_id::text,
          da.categoria, da.titulo, da.descripcion, da.fecha_documento::text,
          da.storage_bucket, da.storage_path, da.mime_type,
          da.tamano_bytes, da.hash_sha256,
          da.adjuntado_por::text, da.adjuntado_en, da.estado_registro,
          da.firmado_por::text, da.firmado_en, da.motivo_anulacion,
          fe.codigo AS estado_documento
        FROM ece.documento_asociado da
        LEFT JOIN ece.documento_instancia di ON di.id = da.instancia_id
        LEFT JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE (${pacienteFilter}::uuid IS NULL OR da.paciente_id = ${pacienteFilter}::uuid)
          AND (${episodioFilter}::uuid IS NULL OR da.episodio_id = ${episodioFilter}::uuid)
          AND (${categoriaFilter}::text IS NULL OR da.categoria = ${categoriaFilter}::text)
        ORDER BY da.adjuntado_en DESC
        LIMIT ${input.pageSize} OFFSET ${offset}
      `;

      const [{ total }] = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<[{ total: bigint }]>)`
        SELECT COUNT(*) AS total
        FROM ece.documento_asociado da
        WHERE (${pacienteFilter}::uuid IS NULL OR da.paciente_id = ${pacienteFilter}::uuid)
          AND (${episodioFilter}::uuid IS NULL OR da.episodio_id = ${episodioFilter}::uuid)
          AND (${categoriaFilter}::text IS NULL OR da.categoria = ${categoriaFilter}::text)
      `;

      return {
        items: rows.map((r) => ({ ...r, tamanoBytes: Number(r.tamano_bytes) })),
        total: Number(total),
        page: input.page,
        pageSize: input.pageSize,
      };
    });
  }),

  /** Lectura individual por id. */
  get: readerProc.input(documentoAsociadoGetInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<DocAsocRow[]>)`
        SELECT
          da.id::text, da.instancia_id::text, da.paciente_id::text,
          da.episodio_id::text, da.establecimiento_id::text,
          da.categoria, da.titulo, da.descripcion, da.fecha_documento::text,
          da.storage_bucket, da.storage_path, da.mime_type,
          da.tamano_bytes, da.hash_sha256,
          da.adjuntado_por::text, da.adjuntado_en, da.estado_registro,
          da.firmado_por::text, da.firmado_en, da.motivo_anulacion,
          fe.codigo AS estado_documento
        FROM ece.documento_asociado da
        LEFT JOIN ece.documento_instancia di ON di.id = da.instancia_id
        LEFT JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE da.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Documento asociado no encontrado." });
      }
      const r = rows[0]!;
      return { ...r, tamanoBytes: Number(r.tamano_bytes) };
    });
  }),

  /**
   * Persiste metadata del documento después de que el archivo ya fue subido
   * a Supabase Storage. Crea documento_instancia (DOC_ASOC) en estado borrador.
   *
   * Obtener la URL de upload firmada vía:
   *   POST /api/ece/documento-asociado/signed-url
   */
  create: writerProc.input(documentoAsociadoCreateInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // 1. Personal de salud activo
      const personal = await findPersonal(tx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El usuario no tiene un registro de personal de salud activo en ECE.",
        });
      }

      // 2. Tipo documento DOC_ASOC + estado inicial
      const tipoDocRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
        SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
        FROM ece.tipo_documento td
        JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
        WHERE td.codigo = 'DOC_ASOC'
        LIMIT 1
      `;
      if (tipoDocRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tipo documento DOC_ASOC no está configurado en el motor de workflow.",
        });
      }
      const { tipo_doc_id, estado_inicial_id } = tipoDocRows[0]!;

      // 3. Crear documento_instancia
      const instanciaRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.documento_instancia
          (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
        VALUES (
          ${tipo_doc_id}::uuid,
          ${input.episodioId ?? null}::uuid,
          ${input.pacienteId}::uuid,
          ${estado_inicial_id}::uuid,
          ${personal.id}::uuid
        )
        RETURNING id::text
      `;
      const instanciaId = instanciaRows[0]!.id;

      // 4. INSERT documento_asociado
      const docRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.documento_asociado (
          instancia_id, paciente_id, episodio_id, establecimiento_id,
          categoria, titulo, descripcion,
          storage_path, mime_type, tamano_bytes, hash_sha256,
          adjuntado_por
        ) VALUES (
          ${instanciaId}::uuid,
          ${input.pacienteId}::uuid,
          ${input.episodioId ?? null}::uuid,
          ${eceCtx.establecimientoId}::uuid,
          ${input.categoria},
          ${input.titulo},
          ${input.descripcion ?? null},
          ${input.storagePath},
          ${input.mimeType},
          ${input.tamanoBytes},
          ${input.hashSha256},
          ${ctx.user.id}::uuid
        )
        RETURNING id::text
      `;
      const docId = docRows[0]!.id;

      // 5. Evento outbox
      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.documento_asociado.adjuntado",
        aggregateType: "DocumentoAsociado",
        aggregateId: docId,
        emittedById: ctx.user.id,
        payload: {
          documentoId: docId,
          instanciaId,
          pacienteId: input.pacienteId,
          episodioId: input.episodioId ?? null,
          categoria: input.categoria,
          titulo: input.titulo,
          mimeType: input.mimeType,
          tamanoBytes: input.tamanoBytes,
          hashSha256: input.hashSha256,
          adjuntadoPor: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, id: docId, instanciaId };
    });
  }),

  /**
   * Firma el documento con PIN argon2id.
   * El trigger SQL trg_doc_asoc_inmutable impide modificar contenido post-firma.
   */
  firmar: writerProc.input(documentoAsociadoFirmarInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const docRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<DocAsocRow[]>)`
        SELECT
          da.id::text, da.instancia_id::text, da.paciente_id::text,
          da.episodio_id::text, da.establecimiento_id::text,
          da.categoria, da.titulo, da.descripcion, da.fecha_documento::text,
          da.storage_bucket, da.storage_path, da.mime_type,
          da.tamano_bytes, da.hash_sha256,
          da.adjuntado_por::text, da.adjuntado_en, da.estado_registro,
          da.firmado_por::text, da.firmado_en, da.motivo_anulacion,
          fe.codigo AS estado_documento
        FROM ece.documento_asociado da
        LEFT JOIN ece.documento_instancia di ON di.id = da.instancia_id
        LEFT JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE da.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (docRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Documento asociado no encontrado." });
      }

      const doc = docRows[0]!;

      if (doc.estado_registro === "firmado") {
        throw new TRPCError({ code: "CONFLICT", message: "El documento ya está firmado." });
      }
      if (doc.estado_registro === "anulado") {
        throw new TRPCError({ code: "CONFLICT", message: "El documento está anulado y no puede firmarse." });
      }

      const { firmaId, personalId } = await verifyPin(tx, ctx.user.id, input.firmaPin);

      // Marcar firmado en payload
      await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
        UPDATE ece.documento_asociado
        SET estado_registro = 'firmado',
            firmado_por     = ${ctx.user.id}::uuid,
            firmado_en      = now()
        WHERE id = ${input.id}::uuid
      `;

      // Avanzar workflow en documento_instancia
      const transRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ estado_destino_id: string }>>)`
        SELECT ft.estado_destino_id::text
        FROM ece.flujo_transicion ft
        JOIN ece.flujo_estado fe_origen ON fe_origen.id = ft.estado_origen_id
        JOIN ece.documento_instancia di ON di.estado_actual_id = fe_origen.id
        WHERE di.id = ${doc.instancia_id}::uuid AND ft.accion = 'firmar'
        LIMIT 1
      `;

      if (transRows.length > 0) {
        await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
          UPDATE ece.documento_instancia
          SET estado_actual_id = ${transRows[0]!.estado_destino_id}::uuid,
              version          = version + 1
          WHERE id = ${doc.instancia_id}::uuid
        `;
      }

      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.documento_asociado.firmado",
        aggregateType: "DocumentoAsociado",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          documentoId: input.id,
          instanciaId: doc.instancia_id,
          pacienteId: doc.paciente_id,
          episodioId: doc.episodio_id,
          hashSha256: doc.hash_sha256,
          firmaId,
          firmadoPor: personalId,
          firmadoEn: new Date().toISOString(),
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, estado: "firmado" };
    });
  }),

  /**
   * Anulación administrativa (solo DIR/ADMIN, solo borrador).
   * Un documento firmado requiere proceso administrativo.
   */
  anular: requireRole(["DIR", "ADMIN"]).input(documentoAsociadoAnularInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const stateRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ estado_registro: string; instancia_id: string }>>)`
        SELECT estado_registro, instancia_id::text
        FROM ece.documento_asociado
        WHERE id = ${input.id}::uuid
        LIMIT 1
      `;

      if (stateRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Documento asociado no encontrado." });
      }

      const { estado_registro, instancia_id } = stateRows[0]!;

      if (estado_registro === "anulado") {
        throw new TRPCError({ code: "CONFLICT", message: "El documento ya está anulado." });
      }
      if (estado_registro === "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Un documento firmado no puede anularse directamente. Inicie un proceso administrativo.",
        });
      }

      await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
        UPDATE ece.documento_asociado
        SET estado_registro  = 'anulado',
            motivo_anulacion = ${input.motivoAnulacion}
        WHERE id = ${input.id}::uuid
      `;

      // Avanzar workflow si existe transición 'anular'
      const transAnular = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ estado_destino_id: string }>>)`
        SELECT ft.estado_destino_id::text
        FROM ece.flujo_transicion ft
        JOIN ece.flujo_estado fe_origen ON fe_origen.id = ft.estado_origen_id
        JOIN ece.documento_instancia di ON di.estado_actual_id = fe_origen.id
        WHERE di.id = ${instancia_id}::uuid AND ft.accion = 'anular'
        LIMIT 1
      `;

      if (transAnular.length > 0) {
        await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
          UPDATE ece.documento_instancia
          SET estado_actual_id = ${transAnular[0]!.estado_destino_id}::uuid,
              version          = version + 1,
              estado_registro  = 'anulado'
          WHERE id = ${instancia_id}::uuid
        `;
      }

      return { ok: true as const, estado: "anulado" };
    });
  }),
});
