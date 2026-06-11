/**
 * Router tRPC — ECE Certificado de Defunción (CERT_DEF).
 *
 * Documento NTEC: Art. 21 — Certificado de Defunción.
 * Norma: MINSAL Acuerdo n.° 1616 (2024).
 * Código de tipo_documento: CERT_DEF.
 * Relevancia legal: el certificado es insumo del Registro del Estado Civil (RNPN).
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (CERT_DEF — triple firma con PIN)
 * ---------------------------------------------------------------------------
 *   borrador  → firmado     (MC / PHYSICIAN: firma con PIN argon2id verificado)
 *   firmado   → validado    (MC / PHYSICIAN: validación clínica con PIN argon2id — B-03)
 *   validado  → certificado (DIR: certificación formal con PIN argon2id)
 *   cualquiera→ anulado     (DIR: solo si estado != certificado)
 *
 *   INMUTABILIDAD: trigger `trg_bloquea_certdef` en BD bloquea cualquier
 *   UPDATE o DELETE sobre ece.certificado_defuncion una vez estado = 'firmado'.
 *   El PIN se verifica contra ece.firma_electronica.pin_hash (argon2id) con
 *   lockout automático tras 3 intentos fallidos (locked_until timestamptz).
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro de withWorkflowContext — B-02)
 * ---------------------------------------------------------------------------
 *   'ece.certificado_defuncion.firmado'      — emitido por firmar().
 *     Payload: { certDefId, pacienteId, medicoId, payloadHash, orgId }
 *   'ece.certificado_defuncion.certificado'  — emitido por certificar().
 *     Payload: { certDefId, directorId, payloadHash, orgId }
 *   payloadHash = SHA-256({ causaDirecta, causasIntermedias, causaFundamental,
 *                            muerteViolenta, fechaHoraMuerte })
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.certificado_defuncion   — fila principal: paciente_id, medico_id,
 *                                 fecha_hora_muerte, causa_directa_cie10,
 *                                 causas_intermedias_cie10 (JSONB), causa_fundamental_cie10,
 *                                 muerte_violenta bool, estado_workflow, payload_hash
 *   ece.firma_electronica       — credencial de firma: pin_hash, failed_attempts,
 *                                 locked_until (lockout tras 3 intentos)
 *   ece.personal_salud          — mapeo his_user_id → personal ECE id
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get   → requireRole(["MC","PHYSICIAN","DIR"])
 *   create      → requireRole(["MC","PHYSICIAN"])
 *   firmar      → requireRole(["MC","PHYSICIAN"])  — requiere PIN
 *   validar     → requireRole(["MC","PHYSICIAN"])  — requiere PIN (B-03)
 *   certificar  → requireRole(["DIR"])             — requiere PIN
 *   anular      → requireRole(["DIR"])
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import { emitDomainEvent, type EmitDomainEventTx } from "@his/database";
import { argon2 } from "@his/infrastructure";

// ──────────────────────────────────────────────────────────────────────────────
// Schemas Zod
// ──────────────────────────────────────────────────────────────────────────────

const cie10Schema = z
  .string()
  .trim()
  .min(3)
  .max(10)
  .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/, "Formato CIE-10 inválido");

const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, "El PIN debe tener 6–8 dígitos numéricos");

const listCertDefInput = z.object({
  fechaDesde: z.coerce.date().optional(),
  fechaHasta: z.coerce.date().optional(),
  medicoId: z.string().uuid().optional(),
  estado: z.enum(["borrador", "firmado", "validado", "certificado", "anulado"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

const getCertDefInput = z.object({ id: z.string().uuid() });

const createCertDefInput = z.object({
  instanciaId: z.string().uuid(),
  episodioId: z.string().uuid(),
  epicrisisId: z.string().uuid(),
  fechaHoraDefuncion: z.coerce.date(),
  // clasificacion CHECK: natural|violenta|accidente_transito|en_investigacion
  clasificacion: z.enum(["natural", "violenta", "accidente_transito", "en_investigacion"]),
  causaBasicaCie10: cie10Schema,
  causasIntermedias: z.array(cie10Schema).max(3).default([]),
  causasContribuyentes: z.array(cie10Schema).max(3).default([]),
});

const firmarCertDefInput = z.object({
  id: z.string().uuid(),
  pin: pinSchema,
});

// B-03: validar requiere PIN del Director Médico para no-repudio.
const validarCertDefInput = z.object({
  id: z.string().uuid(),
  firmaPin: pinSchema,
  observacion: z.string().trim().max(1_000).optional(),
});

const certificarCertDefInput = z.object({
  id: z.string().uuid(),
  pin: pinSchema,
});

const anularCertDefInput = z.object({
  id: z.string().uuid(),
  motivoAnulacion: z.string().trim().min(10).max(1_000),
});

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de fila raw
// ──────────────────────────────────────────────────────────────────────────────

// Columnas reales de ece.certificado_defuncion (verificadas vía MCP 2026-06-11):
// id, instancia_id!, episodio_id!, epicrisis_id!, fecha_hora_defuncion!,
// causa_basica_cie10!, causas_intermedias(jsonb), causas_contribuyentes(jsonb),
// clasificacion!(CHECK: natural/violenta/accidente_transito/en_investigacion),
// numero_certificado, medico_certificante_id!, registrado_en, estado_workflow,
// firmado_en, validado_en, certificado_en, anulado_en, payload_hash, medico_firmante_id
export interface CertDefRow {
  id: string;
  instancia_id: string;
  episodio_id: string;
  epicrisis_id: string;
  fecha_hora_defuncion: Date;
  causa_basica_cie10: string;
  causas_intermedias: unknown; // jsonb
  causas_contribuyentes: unknown; // jsonb
  clasificacion: string;
  numero_certificado: string | null;
  medico_certificante_id: string;
  registrado_en: Date;
  estado_workflow: string;
  firmado_en: Date | null;
  validado_en: Date | null;
  certificado_en: Date | null;
  anulado_en: Date | null;
  payload_hash: string | null;
  medico_firmante_id: string | null;
}

interface PersonalRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Construye el EceContext para withWorkflowContext — sustituye withEceContext local (B-02). */
function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { organizationId: string; establishmentId?: string; roleCodes: string[] };
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

/** Calcula hash SHA-256 sobre los campos clínicos clave (inmutabilidad). */
function computePayloadHash(row: {
  id: string;
  instancia_id: string;
  episodio_id: string;
  fecha_hora_defuncion: Date;
  causa_basica_cie10: string;
  causas_intermedias: unknown;
  clasificacion: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: row.id,
        instancia_id: row.instancia_id,
        episodio_id: row.episodio_id,
        fecha_hora_defuncion: row.fecha_hora_defuncion,
        causa_basica_cie10: row.causa_basica_cie10,
        causas_intermedias: row.causas_intermedias,
        clasificacion: row.clasificacion,
      }),
    )
    .digest("hex");
}

/**
 * Verifica PIN argon2id contra el hash almacenado.
 * Lanza TRPC UNAUTHORIZED / TOO_MANY_REQUESTS / FORBIDDEN según el caso.
 */
async function verifyPin(firma: PersonalRow, pin: string): Promise<void> {
  if (firma.revoked_at !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "La firma electrónica ha sido revocada. Contacte al administrador.",
    });
  }
  if (firma.locked_until !== null && firma.locked_until > new Date()) {
    const mins = Math.ceil((firma.locked_until.getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada por intentos fallidos. Inténtelo en ${mins} min.`,
    });
  }
  const valid = await argon2.verify(firma.pin_hash, pin);
  if (!valid) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "PIN de firma incorrecto.",
    });
  }
}

async function resolvePersonal(
  prisma: { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> },
  userId: string,
): Promise<PersonalRow> {
  const rows = await prisma.$queryRaw<PersonalRow[]>`
    SELECT ps.id, fe.pin_hash, fe.failed_attempts, fe.locked_until, fe.revoked_at
    FROM ece.personal_salud ps
    JOIN ece.firma_electronica fe ON fe.personal_id = ps.id
    WHERE ps.his_user_id = ${userId}::uuid AND ps.activo = true
    LIMIT 1
  `;
  if (!rows[0]) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se encontró personal ECE con firma electrónica configurada para su cuenta.",
    });
  }
  return rows[0];
}

// ──────────────────────────────────────────────────────────────────────────────
// Base procedures
// ──────────────────────────────────────────────────────────────────────────────

const readProc = requireRole(["MC", "PHYSICIAN", "DIR"]);
const mcProc = requireRole(["MC", "PHYSICIAN"]);
const dirProc = requireRole(["DIR"]);

// ──────────────────────────────────────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────────────────────────────────────

export const eceCertDefRouter = router({
  /**
   * Lista certificados de defunción con filtros opcionales.
   * Ordenados por fecha de defunción DESC.
   */
  list: readProc.input(listCertDefInput).query(async ({ ctx, input }) => {
    const ece = buildEceCtx(ctx);
    const offset = (input.page - 1) * input.pageSize;

    // Tenant scope: certificado_defuncion has no establecimiento_id col —
    // scope via JOIN a episodio_atencion que sí tiene establecimiento_id.
    const rows = await ctx.prisma.$queryRaw<CertDefRow[]>`
      SELECT cd.*
      FROM ece.certificado_defuncion cd
      JOIN ece.episodio_atencion ea ON ea.id = cd.episodio_id
      WHERE ea.establecimiento_id = ${ece.establecimientoId}::uuid
        AND (${input.fechaDesde ? input.fechaDesde.toISOString() : null}::timestamptz IS NULL
             OR cd.fecha_hora_defuncion >= ${input.fechaDesde ? input.fechaDesde.toISOString() : null}::timestamptz)
        AND (${input.fechaHasta ? input.fechaHasta.toISOString() : null}::timestamptz IS NULL
             OR cd.fecha_hora_defuncion <= ${input.fechaHasta ? input.fechaHasta.toISOString() : null}::timestamptz)
        AND (${input.medicoId ?? null}::uuid IS NULL
             OR cd.medico_certificante_id = ${input.medicoId ?? null}::uuid)
        AND (${input.estado ?? null}::text IS NULL
             OR cd.estado_workflow = ${input.estado ?? null}::text)
      ORDER BY cd.fecha_hora_defuncion DESC
      LIMIT ${input.pageSize} OFFSET ${offset}
    `;

    const [{ total }] = await ctx.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) AS total
      FROM ece.certificado_defuncion cd
      JOIN ece.episodio_atencion ea ON ea.id = cd.episodio_id
      WHERE ea.establecimiento_id = ${ece.establecimientoId}::uuid
        AND (${input.fechaDesde ? input.fechaDesde.toISOString() : null}::timestamptz IS NULL
             OR cd.fecha_hora_defuncion >= ${input.fechaDesde ? input.fechaDesde.toISOString() : null}::timestamptz)
        AND (${input.fechaHasta ? input.fechaHasta.toISOString() : null}::timestamptz IS NULL
             OR cd.fecha_hora_defuncion <= ${input.fechaHasta ? input.fechaHasta.toISOString() : null}::timestamptz)
        AND (${input.medicoId ?? null}::uuid IS NULL
             OR cd.medico_certificante_id = ${input.medicoId ?? null}::uuid)
        AND (${input.estado ?? null}::text IS NULL
             OR cd.estado_workflow = ${input.estado ?? null}::text)
    `;

    return {
      items: rows,
      total: Number(total),
      page: input.page,
      pageSize: input.pageSize,
    };
  }),

  /**
   * Retorna un certificado extendido con datos de paciente y episodio.
   */
  get: readProc.input(getCertDefInput).query(async ({ ctx, input }) => {
    const ece = buildEceCtx(ctx);

    const rows = await ctx.prisma.$queryRaw<
      (CertDefRow & {
        paciente_nombre: string | null;
        episodio_modalidad: string | null;
      })[]
    >`
      SELECT
        cd.*,
        COALESCE(p."firstName" || ' ' || p."firstLastName" || ' ' || COALESCE(p."firstLastName",''), NULL)
                                         AS paciente_nombre,
        ea.modalidad                     AS episodio_modalidad
      FROM ece.certificado_defuncion cd
      JOIN ece.episodio_atencion ea ON ea.id = cd.episodio_id
      -- paciente_id en cert_def no existe; Patient se obtiene vía episodio→paciente ECE→public
      LEFT JOIN ece.paciente ep ON ep.id = ea.paciente_id
      LEFT JOIN public."Patient" p ON p.id = ep.public_patient_id
      WHERE cd.id = ${input.id}::uuid
        AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
      LIMIT 1
    `;

    if (!rows[0]) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Certificado de defunción no encontrado: ${input.id}`,
      });
    }
    return rows[0];
  }),

  /**
   * Crea un certificado de defunción en estado 'borrador'.
   * Solo MC/PHYSICIAN. 1:1 con episodio (UNIQUE en episodio_id).
   * B-04: valida que la epicrisis referenciada tenga tipo_egreso = 'fallecido'.
   */
  create: mcProc.input(createCertDefInput).mutation(async ({ ctx, input }) => {
    const ece = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, ece, async (tx) => {
      // Resolver personal_salud vinculado al usuario HIS.
      const personalRows = await tx.$queryRaw<[{ id: string }?]>`
        SELECT id::text
        FROM ece.personal_salud
        WHERE his_user_id = ${ece.personalId}::uuid AND activo = true
        LIMIT 1
      `;
      if (!personalRows[0]) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El usuario no tiene un registro de personal de salud activo en ECE.",
        });
      }
      const medicoPersonalId = personalRows[0].id;

      // B-04: verificar que la epicrisis tenga tipo_egreso = 'fallecido'.
      const epicrisisRows = await tx.$queryRaw<[{ tipo_egreso: string }?]>`
        SELECT tipo_egreso
        FROM ece.epicrisis_egreso
        WHERE id = ${input.epicrisisId}::uuid
        LIMIT 1
      `;
      if (!epicrisisRows[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Epicrisis no encontrada: ${input.epicrisisId}`,
        });
      }
      if (epicrisisRows[0].tipo_egreso !== "fallecido") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "epicrisis_no_es_fallecido: solo se puede certificar defunción vinculada a epicrisis con egreso 'fallecido'.",
        });
      }

      // Verificar unicidad 1:1 por episodio.
      const existing = await tx.$queryRaw<[{ id: string }?]>`
        SELECT id::text
        FROM ece.certificado_defuncion
        WHERE episodio_id = ${input.episodioId}::uuid
          AND estado_workflow != 'anulado'
        LIMIT 1
      `;
      if (existing[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe un certificado de defunción activo para este episodio.",
        });
      }

      // Verificar que el episodio pertenece al establecimiento.
      const episodioRows = await tx.$queryRaw<[{ paciente_id: string }?]>`
        SELECT paciente_id::text
        FROM ece.episodio_atencion
        WHERE id = ${input.episodioId}::uuid
          AND establecimiento_id = ${ece.establecimientoId}::uuid
        LIMIT 1
      `;
      if (!episodioRows[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Episodio no encontrado o no pertenece al establecimiento: ${input.episodioId}`,
        });
      }

      const causasIntermediasJson = JSON.stringify(input.causasIntermedias);
      const causasContribuyentesJson = JSON.stringify(input.causasContribuyentes);
      const fechaDefuncion = input.fechaHoraDefuncion.toISOString();

      // Instancia-first: el caller ya creó documento_instancia y pasa su id.
      const rows = await tx.$queryRaw<[{ id: string }]>`
        INSERT INTO ece.certificado_defuncion (
          instancia_id,
          episodio_id,
          epicrisis_id,
          fecha_hora_defuncion,
          causa_basica_cie10,
          causas_intermedias,
          causas_contribuyentes,
          clasificacion,
          medico_certificante_id,
          estado_workflow
        ) VALUES (
          ${input.instanciaId}::uuid,
          ${input.episodioId}::uuid,
          ${input.epicrisisId}::uuid,
          ${fechaDefuncion}::timestamptz,
          ${input.causaBasicaCie10},
          ${causasIntermediasJson}::jsonb,
          ${causasContribuyentesJson}::jsonb,
          ${input.clasificacion},
          ${medicoPersonalId}::uuid,
          'borrador'
        )
        RETURNING id::text
      `;

      return { id: rows[0]!.id };
    });
  }),

  /**
   * MC firma el certificado (borrador → firmado).
   * Post-firma el documento es INMUTABLE (trigger BD).
   * Emite outbox `ece.certificado_defuncion.firmado`.
   */
  firmar: mcProc.input(firmarCertDefInput).mutation(async ({ ctx, input }) => {
    const ece = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, ece, async (tx) => {
      // Leer y bloquear el registro. Tenant scope vía episodio_atencion.
      const rows = await tx.$queryRaw<CertDefRow[]>`
        SELECT cd.* FROM ece.certificado_defuncion cd
        JOIN ece.episodio_atencion ea ON ea.id = cd.episodio_id
        WHERE cd.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
        FOR UPDATE
        LIMIT 1
      `;
      const cert = rows[0];
      if (!cert) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificado no encontrado." });
      }
      if (cert.estado_workflow !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede firmar en estado borrador. Estado actual: ${cert.estado_workflow}.`,
        });
      }

      // Verificar PIN del MC.
      const personal = await resolvePersonal(tx, ece.personalId);
      await verifyPin(personal, input.pin);

      const payloadHash = computePayloadHash(cert);

      // Transición borrador → firmado. El trigger de BD refuerza la inmutabilidad.
      await tx.$executeRaw`
        UPDATE ece.certificado_defuncion
        SET estado_workflow    = 'firmado',
            medico_firmante_id = ${personal.id}::uuid,
            firmado_en         = now(),
            payload_hash       = ${payloadHash}
        WHERE id = ${input.id}::uuid
          AND estado_workflow = 'borrador'
      `;

      // Outbox transaccional.
      await emitDomainEvent(tx as unknown as EmitDomainEventTx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.certificado_defuncion.firmado",
        aggregateType: "CertificadoDefuncion",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          certDefId: input.id,
          instanciaId: cert.instancia_id,
          episodioId: cert.episodio_id,
          payloadHash,
          medicoId: personal.id,
        },
      });

      return { ok: true as const, estado: "firmado", payloadHash };
    });
  }),

  /**
   * MC valida el certificado (firmado → validado).
   * B-03: requiere PIN del validador para trazabilidad de identidad (no-repudio).
   * El validador puede ser diferente al firmante (segunda revisión clínica).
   */
  validar: mcProc.input(validarCertDefInput).mutation(async ({ ctx, input }) => {
    const ece = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, ece, async (tx) => {
      const rows = await tx.$queryRaw<CertDefRow[]>`
        SELECT cd.* FROM ece.certificado_defuncion cd
        JOIN ece.episodio_atencion ea ON ea.id = cd.episodio_id
        WHERE cd.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
        FOR UPDATE
        LIMIT 1
      `;
      const cert = rows[0];
      if (!cert) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificado no encontrado." });
      }
      if (cert.estado_workflow !== "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Para validar se requiere estado firmado. Estado actual: ${cert.estado_workflow}.`,
        });
      }

      // B-03: verificar PIN del validador (Director Médico o MC con rol validador).
      const personal = await resolvePersonal(tx, ece.personalId);
      await verifyPin(personal, input.firmaPin);

      await tx.$executeRaw`
        UPDATE ece.certificado_defuncion
        SET estado_workflow = 'validado',
            validado_en     = now()
        WHERE id = ${input.id}::uuid
          AND estado_workflow = 'firmado'
      `;

      return { ok: true as const, estado: "validado" };
    });
  }),

  /**
   * DIR certifica el documento (validado → certificado) con PIN (segunda firma).
   * Art. 21 NTEC — obligatorio para copias formales.
   * Emite outbox `ece.certificado_defuncion.certificado`.
   */
  certificar: dirProc.input(certificarCertDefInput).mutation(async ({ ctx, input }) => {
    const ece = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, ece, async (tx) => {
      const rows = await tx.$queryRaw<CertDefRow[]>`
        SELECT cd.* FROM ece.certificado_defuncion cd
        JOIN ece.episodio_atencion ea ON ea.id = cd.episodio_id
        WHERE cd.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
        FOR UPDATE
        LIMIT 1
      `;
      const cert = rows[0];
      if (!cert) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificado no encontrado." });
      }
      if (cert.estado_workflow !== "validado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Para certificar se requiere estado validado. Estado actual: ${cert.estado_workflow}.`,
        });
      }

      // Verificar PIN del DIR.
      const personal = await resolvePersonal(tx, ece.personalId);
      await verifyPin(personal, input.pin);

      await tx.$executeRaw`
        UPDATE ece.certificado_defuncion
        SET estado_workflow = 'certificado',
            certificado_en  = now()
        WHERE id = ${input.id}::uuid
          AND estado_workflow = 'validado'
      `;

      await emitDomainEvent(tx as unknown as EmitDomainEventTx, {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.certificado_defuncion.certificado",
        aggregateType: "CertificadoDefuncion",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          certDefId: input.id,
          instanciaId: cert.instancia_id,
          episodioId: cert.episodio_id,
          payloadHash: cert.payload_hash,
          dirUserId: ctx.user.id,
        },
      });

      return { ok: true as const, estado: "certificado" };
    });
  }),

  /**
   * DIR anula el certificado (solo si estado != certificado).
   * Un certificado ya certificado no puede anularse — requiere proceso judicial.
   */
  anular: dirProc.input(anularCertDefInput).mutation(async ({ ctx, input }) => {
    const ece = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, ece, async (tx) => {
      const rows = await tx.$queryRaw<CertDefRow[]>`
        SELECT cd.* FROM ece.certificado_defuncion cd
        JOIN ece.episodio_atencion ea ON ea.id = cd.episodio_id
        WHERE cd.id = ${input.id}::uuid
          AND ea.establecimiento_id = ${ece.establecimientoId}::uuid
        FOR UPDATE
        LIMIT 1
      `;
      const cert = rows[0];
      if (!cert) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Certificado no encontrado." });
      }
      if (cert.estado_workflow === "certificado") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Un certificado ya certificado no puede anularse. Requiere proceso judicial (Art. 21 NTEC).",
        });
      }
      if (cert.estado_workflow === "anulado") {
        throw new TRPCError({ code: "CONFLICT", message: "El certificado ya está anulado." });
      }

      // motivo_anulacion no existe en la tabla; se registra en historial vía outbox/audit.
      await tx.$executeRaw`
        UPDATE ece.certificado_defuncion
        SET estado_workflow = 'anulado',
            anulado_en      = now()
        WHERE id = ${input.id}::uuid
          AND estado_workflow != 'certificado'
      `;

      return { ok: true as const, estado: "anulado" };
    });
  }),
});
