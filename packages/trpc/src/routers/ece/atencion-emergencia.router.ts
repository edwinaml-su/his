/**
 * Router tRPC — ECE Atención de Emergencia (NTEC Art. 22).
 *
 * Documento: ATN_EMERG — Registro de Atención de Emergencias.
 *
 * ---------------------------------------------------------------------------
 * COLUMNAS REALES ece.atencion_emergencia (verificadas 2026-05-19 via MCP)
 * ---------------------------------------------------------------------------
 *   id                uuid        NOT NULL  gen_random_uuid()
 *   instancia_id      uuid        NOT NULL  → ece.documento_instancia.id
 *   episodio_id       uuid        NOT NULL
 *   circunstancia_llegada text    YES
 *   motivo_consulta   text        YES
 *   examen_fisico     text        YES
 *   disposicion       text        YES
 *   diagnosticos      jsonb       YES
 *   manejo_realizado  jsonb       YES
 *   registrado_por    uuid        NOT NULL  → ece.personal_salud.id
 *   registrado_en     timestamptz NOT NULL  now()
 *   estado_registro   text        NOT NULL  'vigente'
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW
 * ---------------------------------------------------------------------------
 *   borrador → firmado (MT con PIN electrónico)
 *   Estado workflow en ece.documento_instancia (estado_actual_id → flujo_estado).
 *   atencion_emergencia.estado_registro = vigente|anulado (vigencia del registro).
 *
 * ---------------------------------------------------------------------------
 * HF resueltos
 * ---------------------------------------------------------------------------
 *   HF-27: schema drift — columnas mapeadas a BD real
 *   HF-28: create crea documento_instancia antes del INSERT (instancia_id NOT NULL)
 *   HF-29: firmar usa PIN + verifyPin (no acepta firmaId arbitrario)
 *   HF-31: tests actualizados con fixtures de columnas reales
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";
import { withWorkflowContext } from "../../workflow/context";
import type { EceContext } from "../../workflow/context";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

/** Entrada estructurada para campos JSONB diagnósticos / manejo. */
const jsonbTextField = z.object({
  texto: z.string().min(5).max(5_000),
});

const createSchema = z.object({
  episodioId:            z.string().uuid(),
  pacienteId:            z.string().uuid(), // ece.paciente.id — para documento_instancia
  motivoConsulta:        z.string().min(5).max(2_000),
  circunstanciaLlegada:  z.string().max(1_000).optional(),
  examenFisico:          z.string().min(5).max(5_000),
  // CHECK atencion_emergencia_disposicion_check: alta_ambulatoria|observacion|orden_ingreso|referencia
  disposicion:           z.enum(["alta_ambulatoria", "observacion", "orden_ingreso", "referencia"]).optional(),
  diagnosticos:          jsonbTextField,
  manejoRealizado:       jsonbTextField,
});

const updateSchema = z.object({
  id:                    z.string().uuid(),
  motivoConsulta:        z.string().min(5).max(2_000).optional(),
  circunstanciaLlegada:  z.string().max(1_000).optional(),
  examenFisico:          z.string().min(5).max(5_000).optional(),
  // CHECK atencion_emergencia_disposicion_check: alta_ambulatoria|observacion|orden_ingreso|referencia
  disposicion:           z.enum(["alta_ambulatoria", "observacion", "orden_ingreso", "referencia"]).optional(),
  diagnosticos:          jsonbTextField.optional(),
  manejoRealizado:       jsonbTextField.optional(),
});

const getSchema    = z.object({ id: z.string().uuid() });
const firmarSchema = z.object({ id: z.string().uuid(), pin: z.string().min(6).max(32) });
const anularSchema = z.object({ id: z.string().uuid(), motivoAnulacion: z.string().min(10).max(1_000) });

const listSchema = z.object({
  episodioId:  z.string().uuid().optional(),
  pacienteId:  z.string().uuid().optional(),
  fechaDesde:  z.coerce.date().optional(),
  fechaHasta:  z.coerce.date().optional(),
  page:        z.number().int().min(1).default(1),
  pageSize:    z.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

export interface AtencionEmergenciaRow {
  id: string;
  instancia_id: string;
  episodio_id: string;
  circunstancia_llegada: string | null;
  motivo_consulta: string | null;
  examen_fisico: string | null;
  disposicion: string | null;
  diagnosticos: unknown;        // jsonb
  manejo_realizado: unknown;    // jsonb
  registrado_por: string;
  registrado_en: Date;
  estado_registro: string;
  // campo virtual del JOIN con documento_instancia → flujo_estado
  estado_documento: string | null;
}

// ---------------------------------------------------------------------------
// Helper tipos para raw SQL
// ---------------------------------------------------------------------------

type RawTx = {
  $queryRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
  $executeRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
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

async function withEce<T>(
  prisma: Parameters<typeof withWorkflowContext>[0],
  ctx: EceContext,
  fn: Parameters<typeof withWorkflowContext<T>>[2],
): Promise<T> {
  return withWorkflowContext<T>(prisma, ctx, fn);
}

// ---------------------------------------------------------------------------
// Hash de contenido clínico (firma SHA-256)
// ---------------------------------------------------------------------------

function computeContentHash(row: AtencionEmergenciaRow): string {
  const canonical = JSON.stringify({
    id: row.id,
    episodio_id: row.episodio_id,
    motivo_consulta: row.motivo_consulta,
    examen_fisico: row.examen_fisico,
    diagnosticos: row.diagnosticos,
    manejo_realizado: row.manejo_realizado,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Helpers firma electrónica
// Columnas reales de ece.firma_electronica:
//   personal_id, pin_hash, failed_attempts, intentos_fallidos,
//   locked_until, bloqueado_hasta, revoked_at
// ---------------------------------------------------------------------------

const LOCKOUT_MAX = 5;

interface FirmaRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  intentos_fallidos: number;
  locked_until: Date | null;
  bloqueado_hasta: Date | null;
  revoked_at: Date | null;
}

async function findPersonal(
  tx: RawTx,
  hisUserId: string,
): Promise<{ id: string } | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<Array<{ id: string }>>)`
    SELECT id::text FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findFirma(
  tx: RawTx,
  personalId: string,
): Promise<FirmaRow | null> {
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

/**
 * Verifica el PIN de firma electrónica del usuario.
 * HF-29: rechaza cualquier PIN inválido o firma bloqueada/revocada.
 * Usa columnas reales de ece.firma_electronica (personal_id, intentos_fallidos, bloqueado_hasta).
 */
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

  // Verificar bloqueo temporal (columna española tiene precedencia)
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

  // Resetear contadores en login exitoso
  await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
    UPDATE ece.firma_electronica
    SET intentos_fallidos = 0, failed_attempts = 0
    WHERE id = ${firma.id}::uuid
  `;

  return { firmaId: firma.id, personalId: personal.id };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const readerProc = requireRole(["MT", "PHYSICIAN", "NURSE", "DIR", "ADMIN"]);
const writerProc = requireRole(["MT", "PHYSICIAN"]);

export const atencionEmergenciaRouter = router({

  /** Lista atenciones con filtros opcionales. */
  list: readerProc.input(listSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const episodioFilter = input.episodioId ?? null;
      const pacienteFilter = input.pacienteId ?? null;
      const fechaDesde = input.fechaDesde ?? null;
      const fechaHasta = input.fechaHasta ?? null;
      const offset = (input.page - 1) * input.pageSize;

      const rows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<AtencionEmergenciaRow[]>)`
        SELECT
          ae.id::text, ae.instancia_id::text, ae.episodio_id::text,
          ae.circunstancia_llegada, ae.motivo_consulta, ae.examen_fisico,
          ae.disposicion, ae.diagnosticos, ae.manejo_realizado,
          ae.registrado_por::text, ae.registrado_en, ae.estado_registro,
          fe.codigo AS estado_documento
        FROM ece.atencion_emergencia ae
        LEFT JOIN ece.documento_instancia di ON di.id = ae.instancia_id
        LEFT JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE (${episodioFilter}::uuid IS NULL OR ae.episodio_id = ${episodioFilter}::uuid)
          AND (${pacienteFilter}::uuid IS NULL OR di.paciente_id = ${pacienteFilter}::uuid)
          AND (${fechaDesde}::timestamptz IS NULL OR ae.registrado_en >= ${fechaDesde}::timestamptz)
          AND (${fechaHasta}::timestamptz IS NULL OR ae.registrado_en <= ${fechaHasta}::timestamptz)
        ORDER BY ae.registrado_en DESC
        LIMIT ${input.pageSize} OFFSET ${offset}
      `;

      const [{ total }] = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<[{ total: bigint }]>)`
        SELECT COUNT(*) AS total
        FROM ece.atencion_emergencia ae
        LEFT JOIN ece.documento_instancia di ON di.id = ae.instancia_id
        WHERE (${episodioFilter}::uuid IS NULL OR ae.episodio_id = ${episodioFilter}::uuid)
          AND (${pacienteFilter}::uuid IS NULL OR di.paciente_id = ${pacienteFilter}::uuid)
          AND (${fechaDesde}::timestamptz IS NULL OR ae.registrado_en >= ${fechaDesde}::timestamptz)
          AND (${fechaHasta}::timestamptz IS NULL OR ae.registrado_en <= ${fechaHasta}::timestamptz)
      `;

      return {
        items: rows,
        total: Number(total),
        page: input.page,
        pageSize: input.pageSize,
      };
    });
  }),

  /** Lectura individual por id. */
  get: readerProc.input(getSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<AtencionEmergenciaRow[]>)`
        SELECT
          ae.id::text, ae.instancia_id::text, ae.episodio_id::text,
          ae.circunstancia_llegada, ae.motivo_consulta, ae.examen_fisico,
          ae.disposicion, ae.diagnosticos, ae.manejo_realizado,
          ae.registrado_por::text, ae.registrado_en, ae.estado_registro,
          fe.codigo AS estado_documento
        FROM ece.atencion_emergencia ae
        LEFT JOIN ece.documento_instancia di ON di.id = ae.instancia_id
        LEFT JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE ae.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Atención de emergencia no encontrada.",
        });
      }
      return rows[0]!;
    });
  }),

  /**
   * Crea una atención en estado borrador.
   *
   * HF-28: Pasos obligatorios antes del INSERT a atencion_emergencia:
   *   1. Resolver personal_salud activo del usuario.
   *   2. Resolver tipo_documento ATN_EMERG + estado_inicial_id.
   *   3. Crear documento_instancia → obtener instancia_id (NOT NULL).
   *   4. INSERT atencion_emergencia con instancia_id.
   *   5. Emitir evento outbox.
   */
  create: writerProc.input(createSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      // 1. Personal de salud activo
      const personal = await findPersonal(tx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El usuario no tiene un registro de personal de salud activo en ECE.",
        });
      }

      // 2. Tipo documento ATN_EMERG + estado inicial
      const tipoDocRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
        SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
        FROM ece.tipo_documento td
        JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
        WHERE td.codigo = 'ATN_EMERG'
        LIMIT 1
      `;
      if (tipoDocRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tipo documento ATN_EMERG no está configurado en el motor de workflow.",
        });
      }
      const { tipo_doc_id, estado_inicial_id } = tipoDocRows[0]!;

      // 3. Crear documento_instancia (resuelve HF-28: instancia_id NOT NULL)
      const instanciaRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.documento_instancia
          (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
        VALUES (
          ${tipo_doc_id}::uuid,
          ${input.episodioId}::uuid,
          ${input.pacienteId}::uuid,
          ${estado_inicial_id}::uuid,
          ${personal.id}::uuid
        )
        RETURNING id::text
      `;
      const instanciaId = instanciaRows[0]!.id;

      // 4. INSERT atencion_emergencia con instancia_id
      const atnRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.atencion_emergencia (
          instancia_id,
          episodio_id,
          circunstancia_llegada,
          motivo_consulta,
          examen_fisico,
          disposicion,
          diagnosticos,
          manejo_realizado,
          registrado_por
        ) VALUES (
          ${instanciaId}::uuid,
          ${input.episodioId}::uuid,
          ${input.circunstanciaLlegada ?? null},
          ${input.motivoConsulta},
          ${input.examenFisico},
          ${input.disposicion ?? null},
          ${JSON.stringify(input.diagnosticos)}::jsonb,
          ${JSON.stringify(input.manejoRealizado)}::jsonb,
          ${personal.id}::uuid
        )
        RETURNING id::text
      `;
      const atnId = atnRows[0]!.id;

      // 5. Outbox
      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.atencion_emergencia.creada",
        aggregateType: "AtencionEmergencia",
        aggregateId: atnId,
        emittedById: ctx.user.id,
        payload: {
          atencionId: atnId,
          instanciaId,
          episodioId: input.episodioId,
          pacienteId: input.pacienteId,
          registradoPor: personal.id,
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, id: atnId, instanciaId };
    });
  }),

  /**
   * Actualiza campos clínicos. Solo en estado borrador o en_revision.
   * Estado leído desde documento_instancia via JOIN flujo_estado.
   */
  update: writerProc.input(updateSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const stateRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ estado_codigo: string; instancia_id: string }>>)`
        SELECT fe.codigo AS estado_codigo, ae.instancia_id::text
        FROM ece.atencion_emergencia ae
        JOIN ece.documento_instancia di ON di.id = ae.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE ae.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (stateRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Atención de emergencia no encontrada." });
      }

      const estadoCodigo = stateRows[0]!.estado_codigo;
      if (estadoCodigo !== "borrador" && estadoCodigo !== "en_revision") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede editar en estado borrador o en_revision. Estado actual: ${estadoCodigo}.`,
        });
      }

      const { id: _id, ...fields } = input;

      if (fields.motivoConsulta !== undefined) {
        await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
          UPDATE ece.atencion_emergencia SET motivo_consulta = ${fields.motivoConsulta}
          WHERE id = ${input.id}::uuid
        `;
      }
      if (fields.circunstanciaLlegada !== undefined) {
        await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
          UPDATE ece.atencion_emergencia SET circunstancia_llegada = ${fields.circunstanciaLlegada}
          WHERE id = ${input.id}::uuid
        `;
      }
      if (fields.examenFisico !== undefined) {
        await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
          UPDATE ece.atencion_emergencia SET examen_fisico = ${fields.examenFisico}
          WHERE id = ${input.id}::uuid
        `;
      }
      if (fields.disposicion !== undefined) {
        await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
          UPDATE ece.atencion_emergencia SET disposicion = ${fields.disposicion}
          WHERE id = ${input.id}::uuid
        `;
      }
      if (fields.diagnosticos !== undefined) {
        await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
          UPDATE ece.atencion_emergencia SET diagnosticos = ${JSON.stringify(fields.diagnosticos)}::jsonb
          WHERE id = ${input.id}::uuid
        `;
      }
      if (fields.manejoRealizado !== undefined) {
        await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
          UPDATE ece.atencion_emergencia SET manejo_realizado = ${JSON.stringify(fields.manejoRealizado)}::jsonb
          WHERE id = ${input.id}::uuid
        `;
      }

      return { ok: true as const };
    });
  }),

  /**
   * MT firma la atención con PIN electrónico.
   * HF-29: verifica firma contra ece.firma_electronica; rechaza PIN inválido o bloqueado.
   * Transición estado workflow via documento_instancia.
   * Emite outbox con hash SHA-256 del contenido clínico.
   */
  firmar: writerProc.input(firmarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const docRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<AtencionEmergenciaRow[]>)`
        SELECT
          ae.id::text, ae.instancia_id::text, ae.episodio_id::text,
          ae.circunstancia_llegada, ae.motivo_consulta, ae.examen_fisico,
          ae.disposicion, ae.diagnosticos, ae.manejo_realizado,
          ae.registrado_por::text, ae.registrado_en, ae.estado_registro,
          fe.codigo AS estado_documento
        FROM ece.atencion_emergencia ae
        JOIN ece.documento_instancia di ON di.id = ae.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE ae.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (docRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Atención de emergencia no encontrada." });
      }

      const doc = docRows[0]!;
      if (doc.estado_documento !== "borrador" && doc.estado_documento !== "en_revision") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede firmar en estado borrador o en_revision. Estado actual: ${doc.estado_documento}.`,
        });
      }

      // HF-29: verificar PIN real contra ece.firma_electronica
      const { firmaId, personalId } = await verifyPin(tx, ctx.user.id, input.pin);

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
        const destino = transRows[0]!.estado_destino_id;
        await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
          UPDATE ece.documento_instancia
          SET estado_actual_id = ${destino}::uuid, version = version + 1
          WHERE id = ${doc.instancia_id}::uuid
        `;
      }

      const contentHash = computeContentHash(doc);

      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.atencion_emergencia.firmada",
        aggregateType: "AtencionEmergencia",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          atencionId: input.id,
          instanciaId: doc.instancia_id,
          episodioId: doc.episodio_id,
          contentHash,
          firmaId,
          firmadoPor: personalId,
          firmadaEn: new Date().toISOString(),
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, estado: "firmado", contentHash };
    });
  }),

  /**
   * DIR anula la atención. Terminal antes de validación.
   * Marca estado_registro = 'anulado' y avanza workflow en documento_instancia.
   */
  anular: requireRole(["DIR", "ADMIN"]).input(anularSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const stateRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ estado_codigo: string; instancia_id: string }>>)`
        SELECT fe.codigo AS estado_codigo, ae.instancia_id::text
        FROM ece.atencion_emergencia ae
        JOIN ece.documento_instancia di ON di.id = ae.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE ae.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (stateRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Atención de emergencia no encontrada." });
      }

      const { estado_codigo, instancia_id } = stateRows[0]!;

      if (estado_codigo === "validado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Un documento validado no puede anularse. Inicie un proceso administrativo.",
        });
      }
      if (estado_codigo === "anulado") {
        throw new TRPCError({ code: "CONFLICT", message: "La atención ya está anulada." });
      }

      await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
        UPDATE ece.atencion_emergencia
        SET estado_registro = 'anulado'
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

      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.atencion_emergencia.anulada",
        aggregateType: "AtencionEmergencia",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          atencionId: input.id,
          instanciaId: instancia_id,
          motivoAnulacion: input.motivoAnulacion,
          anuladoPor: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, estado: "anulado" };
    });
  }),
});
