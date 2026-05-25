/**
 * Router tRPC — Certificado de Incapacidad ISSS (CERT_INC).
 *
 * Normativa: ISSS El Salvador — Reglamento de Evaluación de Incapacidades.
 * NTEC §22 (informes ISSS).
 *
 * Workflow: borrador → firmado → (anulado desde firmado, rol MC/PHYSICIAN)
 *
 * Procedimientos:
 *   list    — readerProc — filtra por paciente / rango fechas
 *   get     — readerProc — por id
 *   create  — writerProc — crea documento_instancia (CERT_INC) + insert tabla satélite
 *   firmar  — writerProc — verifica PIN argon2id, avanza workflow, emite evento
 *   anular  — writerProc — solo en estado firmado, requiere motivo ≥10 chars
 */
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";
import { withWorkflowContext } from "../../workflow/context";
import type { EceContext } from "../../workflow/context";
import { assertDependenciasFirmadas } from "../../ece/dependencias-enforcement";
import {
  certificadoIncapacidadCreateInput,
  certificadoIncapacidadFirmarInput,
  certificadoIncapacidadAnularInput,
  certificadoIncapacidadListInput,
  certificadoIncapacidadGetInput,
} from "@his/contracts/schemas/certificado-incapacidad";

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

interface CertIncRow {
  id: string;
  instancia_id: string;
  paciente_id: string;
  episodio_id: string | null;
  establecimiento_id: string;
  medico_id: string;
  tipo_incapacidad: string;
  fecha_inicio: Date;
  fecha_fin: Date;
  dias_otorgados: number;
  diagnostico_cie10: string;
  diagnostico_descripcion: string;
  numero_afiliacion_isss: string | null;
  patrono_nit: string | null;
  observaciones: string | null;
  estado_registro: string;
  motivo_anulacion: string | null;
  registrado_en: Date;
  registrado_por: string;
  // JOIN con flujo_estado
  estado_documento: string | null;
}

type RawTx = {
  $queryRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
  $executeRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Context helpers (mismo patrón que atencion-emergencia.router.ts)
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
// Firma electrónica helpers (copiado exacto de atencion-emergencia.router.ts
// para evitar importación circular — patrón establecido en el proyecto)
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

async function verifyPinOrThrow(
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
// Router
// ---------------------------------------------------------------------------

/** MC y PHYSICIAN emiten certificados; NURSE y DIR pueden leer. */
const readerProc = requireRole(["MC", "PHYSICIAN", "NURSE", "DIR", "ADMIN"]);
const writerProc = requireRole(["MC", "PHYSICIAN"]);

export const certificadoIncapacidadRouter = router({

  /** Lista certificados con filtros opcionales. */
  list: readerProc.input(certificadoIncapacidadListInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const pacienteFilter = input.pacienteId ?? null;
      const fechaDesde = input.fechaDesde ?? null;
      const fechaHasta = input.fechaHasta ?? null;
      const offset = (input.page - 1) * input.pageSize;

      const rows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<CertIncRow[]>)`
        SELECT
          ci.id::text, ci.instancia_id::text, ci.paciente_id::text,
          ci.episodio_id::text, ci.establecimiento_id::text, ci.medico_id::text,
          ci.tipo_incapacidad, ci.fecha_inicio, ci.fecha_fin, ci.dias_otorgados,
          ci.diagnostico_cie10, ci.diagnostico_descripcion,
          ci.numero_afiliacion_isss, ci.patrono_nit, ci.observaciones,
          ci.estado_registro, ci.motivo_anulacion,
          ci.registrado_en, ci.registrado_por::text,
          fe.codigo AS estado_documento
        FROM ece.certificado_incapacidad ci
        LEFT JOIN ece.documento_instancia di ON di.id = ci.instancia_id
        LEFT JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE (${pacienteFilter}::uuid IS NULL OR ci.paciente_id = ${pacienteFilter}::uuid)
          AND (${fechaDesde}::date IS NULL OR ci.fecha_inicio >= ${fechaDesde}::date)
          AND (${fechaHasta}::date IS NULL OR ci.fecha_fin   <= ${fechaHasta}::date)
        ORDER BY ci.registrado_en DESC
        LIMIT ${input.pageSize} OFFSET ${offset}
      `;

      const [{ total }] = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<[{ total: bigint }]>)`
        SELECT COUNT(*) AS total
        FROM ece.certificado_incapacidad ci
        WHERE (${pacienteFilter}::uuid IS NULL OR ci.paciente_id = ${pacienteFilter}::uuid)
          AND (${fechaDesde}::date IS NULL OR ci.fecha_inicio >= ${fechaDesde}::date)
          AND (${fechaHasta}::date IS NULL OR ci.fecha_fin   <= ${fechaHasta}::date)
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
  get: readerProc.input(certificadoIncapacidadGetInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<CertIncRow[]>)`
        SELECT
          ci.id::text, ci.instancia_id::text, ci.paciente_id::text,
          ci.episodio_id::text, ci.establecimiento_id::text, ci.medico_id::text,
          ci.tipo_incapacidad, ci.fecha_inicio, ci.fecha_fin, ci.dias_otorgados,
          ci.diagnostico_cie10, ci.diagnostico_descripcion,
          ci.numero_afiliacion_isss, ci.patrono_nit, ci.observaciones,
          ci.estado_registro, ci.motivo_anulacion,
          ci.registrado_en, ci.registrado_por::text,
          fe.codigo AS estado_documento
        FROM ece.certificado_incapacidad ci
        LEFT JOIN ece.documento_instancia di ON di.id = ci.instancia_id
        LEFT JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE ci.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Certificado de incapacidad no encontrado.",
        });
      }
      return rows[0]!;
    });
  }),

  /**
   * Crea certificado en estado borrador.
   * 1. Resuelve personal_salud.
   * 2. Verifica dependencias firmadas (assertDependenciasFirmadas).
   * 3. Resuelve tipo_documento CERT_INC + estado_inicial.
   * 4. Crea documento_instancia.
   * 5. INSERT ece.certificado_incapacidad.
   */
  create: writerProc.input(certificadoIncapacidadCreateInput).mutation(async ({ ctx, input }) => {
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

      // 2. Enforcement de dependencias (CERT_INC puede requerir FICHA_IDENT, etc.)
      await assertDependenciasFirmadas({
        tx: tx as unknown as Parameters<typeof assertDependenciasFirmadas>[0]["tx"],
        tipoDocCodigo: "CERT_INC",
        episodioId: input.episodioId ?? null,
        pacienteId: input.pacienteId,
        establecimientoId: eceCtx.establecimientoId,
      });

      // 3. Tipo documento CERT_INC + estado inicial
      const tipoDocRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
        SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
        FROM ece.tipo_documento td
        JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
        WHERE td.codigo = 'CERT_INC'
        LIMIT 1
      `;
      if (tipoDocRows.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Tipo documento CERT_INC no está configurado en el motor de workflow.",
        });
      }
      const { tipo_doc_id, estado_inicial_id } = tipoDocRows[0]!;

      // 4. Crear documento_instancia
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

      // 5. INSERT certificado_incapacidad
      const certRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.certificado_incapacidad (
          instancia_id,
          paciente_id,
          episodio_id,
          establecimiento_id,
          medico_id,
          tipo_incapacidad,
          fecha_inicio,
          fecha_fin,
          diagnostico_cie10,
          diagnostico_descripcion,
          numero_afiliacion_isss,
          patrono_nit,
          observaciones,
          registrado_por
        ) VALUES (
          ${instanciaId}::uuid,
          ${input.pacienteId}::uuid,
          ${input.episodioId ?? null}::uuid,
          ${eceCtx.establecimientoId}::uuid,
          ${input.medicoId}::uuid,
          ${input.tipoIncapacidad},
          ${input.fechaInicio}::date,
          ${input.fechaFin}::date,
          ${input.diagnosticoCie10},
          ${input.diagnosticoDescripcion},
          ${input.numeroAfiliacionIsss ?? null},
          ${input.patronoNit ?? null},
          ${input.observaciones ?? null},
          ${personal.id}::uuid
        )
        RETURNING id::text
      `;
      const certId = certRows[0]!.id;

      return { ok: true as const, id: certId, instanciaId, estado: "borrador" };
    });
  }),

  /**
   * Firma el certificado con PIN electrónico.
   * Solo válido en estado borrador. Avanza workflow a firmado.
   */
  firmar: writerProc.input(certificadoIncapacidadFirmarInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const docRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<CertIncRow[]>)`
        SELECT
          ci.id::text, ci.instancia_id::text, ci.paciente_id::text,
          ci.episodio_id::text, ci.establecimiento_id::text, ci.medico_id::text,
          ci.tipo_incapacidad, ci.fecha_inicio, ci.fecha_fin, ci.dias_otorgados,
          ci.diagnostico_cie10, ci.diagnostico_descripcion,
          ci.numero_afiliacion_isss, ci.patrono_nit, ci.observaciones,
          ci.estado_registro, ci.motivo_anulacion,
          ci.registrado_en, ci.registrado_por::text,
          fe.codigo AS estado_documento
        FROM ece.certificado_incapacidad ci
        JOIN ece.documento_instancia di ON di.id = ci.instancia_id
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE ci.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (docRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Certificado de incapacidad no encontrado.",
        });
      }

      const doc = docRows[0]!;
      if (doc.estado_documento !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede firmar en estado borrador. Estado actual: ${doc.estado_documento}.`,
        });
      }

      // Verificar PIN
      const { firmaId, personalId } = await verifyPinOrThrow(tx, ctx.user.id, input.firmaPin);

      // Marcar estado_registro = firmado
      await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
        UPDATE ece.certificado_incapacidad
        SET estado_registro = 'firmado'
        WHERE id = ${input.id}::uuid
      `;

      // Avanzar workflow en documento_instancia si existe transición 'firmar'
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
              version           = version + 1
          WHERE id = ${doc.instancia_id}::uuid
        `;
      }

      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.certificado_incapacidad.firmado",
        aggregateType: "CertificadoIncapacidad",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          certId: input.id,
          instanciaId: doc.instancia_id,
          pacienteId: doc.paciente_id,
          tipoIncapacidad: doc.tipo_incapacidad,
          diasOtorgados: doc.dias_otorgados,
          firmaId,
          firmadoPor: personalId,
          firmadaEn: new Date().toISOString(),
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, estado: "firmado" };
    });
  }),

  /**
   * Anula un certificado firmado. Terminal: solo válido en estado firmado.
   * Requiere motivoAnulacion ≥ 10 chars.
   */
  anular: writerProc.input(certificadoIncapacidadAnularInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const stateRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ estado_registro: string; instancia_id: string; paciente_id: string }>>)`
        SELECT ci.estado_registro, ci.instancia_id::text, ci.paciente_id::text
        FROM ece.certificado_incapacidad ci
        WHERE ci.id = ${input.id}::uuid
        LIMIT 1
      `;

      if (stateRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Certificado de incapacidad no encontrado.",
        });
      }

      const { estado_registro, instancia_id, paciente_id } = stateRows[0]!;

      if (estado_registro !== "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede anular un certificado en estado firmado. Estado actual: ${estado_registro}.`,
        });
      }

      await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
        UPDATE ece.certificado_incapacidad
        SET estado_registro   = 'anulado',
            motivo_anulacion  = ${input.motivoAnulacion}
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
        eventType: "ece.certificado_incapacidad.anulado",
        aggregateType: "CertificadoIncapacidad",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          certId: input.id,
          instanciaId: instancia_id,
          pacienteId: paciente_id,
          motivoAnulacion: input.motivoAnulacion,
          anuladoPor: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
        },
      });

      return { ok: true as const, estado: "anulado" };
    });
  }),
});
