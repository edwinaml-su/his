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
 *   firmado   → validado    (MC / PHYSICIAN: revisión y validación clínica)
 *   validado  → certificado (DIR: certificación formal con PIN argon2id)
 *   cualquiera→ anulado     (DIR: solo si estado != certificado)
 *
 *   INMUTABILIDAD: trigger `trg_certdef_inmutable` en BD bloquea cualquier
 *   UPDATE o DELETE sobre ece.certificado_defuncion una vez estado = 'firmado'.
 *   El PIN se verifica contra ece.firma_electronica.pin_hash (argon2id) con
 *   lockout automático tras 3 intentos fallidos (locked_until timestamptz).
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro de Prisma.$transaction)
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
 *                                 muerte_violenta bool, estado, payload_hash
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
 *   validar     → requireRole(["MC","PHYSICIAN"])
 *   certificar  → requireRole(["DIR"])             — requiere PIN
 *   anular      → requireRole(["DIR"])
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";

// ──────────────────────────────────────────────────────────────────────────────
// Schemas Zod (inline — patrón establecido en routers ECE)
// La fuente de verdad está en packages/contracts/src/schemas/ece-certificado-defuncion.ts
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
  causaPrincipalCie10: cie10Schema.optional(),
  estado: z.enum(["borrador", "firmado", "validado", "certificado", "anulado"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

const getCertDefInput = z.object({ id: z.string().uuid() });

const createCertDefInput = z.object({
  episodioId: z.string().uuid(),
  fechaHoraDefuncion: z.coerce.date(),
  lugarDefuncion: z.enum(["intrahospitalaria", "extrahospitalaria"]),
  causaPrincipalCie10: cie10Schema,
  causasIntermediasCie10: z.array(cie10Schema).max(3).default([]),
  causaBasicaCie10: cie10Schema,
  manera: z.enum(["natural", "violenta", "accidental", "suicidio", "homicidio", "indeterminada"]),
  autopsiaRealizada: z.boolean(),
  observaciones: z.string().trim().max(2_000).optional(),
});

const firmarCertDefInput = z.object({
  id: z.string().uuid(),
  pin: pinSchema,
});

const validarCertDefInput = z.object({
  id: z.string().uuid(),
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

export interface CertDefRow {
  id: string;
  episodio_id: string;
  paciente_id: string | null;
  fecha_hora_defuncion: Date;
  lugar_defuncion: string;
  causa_principal_cie10: string;
  causas_intermedias_cie10: string[];
  causa_basica_cie10: string;
  manera: string;
  autopsia_realizada: boolean;
  observaciones: string | null;
  estado_workflow: string;
  medico_firmante_id: string | null;
  firmado_en: Date | null;
  validado_en: Date | null;
  certificado_en: Date | null;
  anulado_en: Date | null;
  motivo_anulacion: string | null;
  payload_hash: string | null;
  registrado_en: Date;
  establecimiento_id: string;
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

function withEceContext(ctx: {
  user: { id: string };
  tenant: { organizationId: string; establishmentId?: string; roleCodes: string[] };
}) {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar documentos ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    organizationId: ctx.tenant.organizationId,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

/** Calcula hash SHA-256 sobre los campos clínicos clave (inmutabilidad). */
function computePayloadHash(row: {
  id: string;
  episodio_id: string;
  fecha_hora_defuncion: Date;
  causa_principal_cie10: string;
  causas_intermedias_cie10: string[];
  causa_basica_cie10: string;
  manera: string;
  autopsia_realizada: boolean;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: row.id,
        episodio_id: row.episodio_id,
        fecha_hora_defuncion: row.fecha_hora_defuncion,
        causa_principal_cie10: row.causa_principal_cie10,
        causas_intermedias_cie10: row.causas_intermedias_cie10,
        causa_basica_cie10: row.causa_basica_cie10,
        manera: row.manera,
        autopsia_realizada: row.autopsia_realizada,
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
  const argon2 = await import("argon2");
  const valid = await argon2.default.verify(firma.pin_hash, pin);
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
    const ece = withEceContext(ctx);
    const offset = (input.page - 1) * input.pageSize;

    const rows = await ctx.prisma.$queryRaw<CertDefRow[]>`
      SELECT cd.*
      FROM ece.certificado_defuncion cd
      WHERE cd.establecimiento_id = ${ece.establecimientoId}::uuid
        AND (${input.fechaDesde ? input.fechaDesde.toISOString() : null}::timestamptz IS NULL
             OR cd.fecha_hora_defuncion >= ${input.fechaDesde ? input.fechaDesde.toISOString() : null}::timestamptz)
        AND (${input.fechaHasta ? input.fechaHasta.toISOString() : null}::timestamptz IS NULL
             OR cd.fecha_hora_defuncion <= ${input.fechaHasta ? input.fechaHasta.toISOString() : null}::timestamptz)
        AND (${input.medicoId ?? null}::uuid IS NULL
             OR cd.medico_firmante_id = ${input.medicoId ?? null}::uuid)
        AND (${input.causaPrincipalCie10 ?? null}::text IS NULL
             OR cd.causa_principal_cie10 = ${input.causaPrincipalCie10 ?? null}::text)
        AND (${input.estado ?? null}::text IS NULL
             OR cd.estado_workflow = ${input.estado ?? null}::text)
      ORDER BY cd.fecha_hora_defuncion DESC
      LIMIT ${input.pageSize} OFFSET ${offset}
    `;

    const [{ total }] = await ctx.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) AS total
      FROM ece.certificado_defuncion cd
      WHERE cd.establecimiento_id = ${ece.establecimientoId}::uuid
        AND (${input.fechaDesde ? input.fechaDesde.toISOString() : null}::timestamptz IS NULL
             OR cd.fecha_hora_defuncion >= ${input.fechaDesde ? input.fechaDesde.toISOString() : null}::timestamptz)
        AND (${input.fechaHasta ? input.fechaHasta.toISOString() : null}::timestamptz IS NULL
             OR cd.fecha_hora_defuncion <= ${input.fechaHasta ? input.fechaHasta.toISOString() : null}::timestamptz)
        AND (${input.medicoId ?? null}::uuid IS NULL
             OR cd.medico_firmante_id = ${input.medicoId ?? null}::uuid)
        AND (${input.causaPrincipalCie10 ?? null}::text IS NULL
             OR cd.causa_principal_cie10 = ${input.causaPrincipalCie10 ?? null}::text)
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
    const ece = withEceContext(ctx);

    const rows = await ctx.prisma.$queryRaw<
      (CertDefRow & {
        paciente_nombre: string | null;
        paciente_dui: string | null;
        episodio_tipo: string | null;
      })[]
    >`
      SELECT
        cd.*,
        COALESCE(p."firstName" || ' ' || p."firstLastName", NULL) AS paciente_nombre,
        p."nationalId"                                              AS paciente_dui,
        ea.tipo                                                     AS episodio_tipo
      FROM ece.certificado_defuncion cd
      LEFT JOIN ece.episodio_atencion ea ON ea.id = cd.episodio_id
      LEFT JOIN public."Patient"       p  ON p.id = cd.paciente_id
      WHERE cd.id = ${input.id}::uuid
        AND cd.establecimiento_id = ${ece.establecimientoId}::uuid
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
   */
  create: mcProc.input(createCertDefInput).mutation(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    // Resolver personal_salud vinculado al usuario HIS.
    const personalRows = await ctx.prisma.$queryRaw<[{ id: string }?]>`
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

    // Verificar unicidad 1:1 por episodio.
    const existing = await ctx.prisma.$queryRaw<[{ id: string }?]>`
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

    // Obtener paciente_id desde el episodio.
    const episodioRows = await ctx.prisma.$queryRaw<[{ paciente_id: string }?]>`
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
    const pacienteId = episodioRows[0].paciente_id;

    const causasJson = JSON.stringify(input.causasIntermediasCie10);
    const fechaDefuncion = input.fechaHoraDefuncion.toISOString();

    const rows = await ctx.prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO ece.certificado_defuncion (
        episodio_id,
        paciente_id,
        establecimiento_id,
        fecha_hora_defuncion,
        lugar_defuncion,
        causa_principal_cie10,
        causas_intermedias_cie10,
        causa_basica_cie10,
        manera,
        autopsia_realizada,
        observaciones,
        medico_certificante,
        estado_workflow
      ) VALUES (
        ${input.episodioId}::uuid,
        ${pacienteId}::uuid,
        ${ece.establecimientoId}::uuid,
        ${fechaDefuncion}::timestamptz,
        ${input.lugarDefuncion},
        ${input.causaPrincipalCie10},
        ${causasJson}::jsonb,
        ${input.causaBasicaCie10},
        ${input.manera},
        ${input.autopsiaRealizada},
        ${input.observaciones ?? null},
        ${medicoPersonalId}::uuid,
        'borrador'
      )
      RETURNING id::text
    `;

    return { id: rows[0]!.id };
  }),

  /**
   * MC firma el certificado (borrador → firmado).
   * Post-firma el documento es INMUTABLE (trigger BD).
   * Emite outbox `ece.certificado_defuncion.firmado`.
   */
  firmar: mcProc.input(firmarCertDefInput).mutation(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      // Leer y bloquear el registro.
      const rows = await tx.$queryRaw<CertDefRow[]>`
        SELECT * FROM ece.certificado_defuncion
        WHERE id = ${input.id}::uuid
          AND establecimiento_id = ${ece.establecimientoId}::uuid
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
      await emitDomainEvent(tx, {
        organizationId: ece.organizationId,
        eventType: "ece.certificado_defuncion.firmado",
        aggregateType: "CertificadoDefuncion",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          certDefId: input.id,
          episodioId: cert.episodio_id,
          pacienteId: cert.paciente_id,
          payloadHash,
          medicoId: personal.id,
        },
      });

      return { ok: true as const, estado: "firmado", payloadHash };
    });
  }),

  /**
   * MC valida el certificado (firmado → validado).
   * No requiere PIN (segunda revisión del mismo MC o de otro con rol MC).
   */
  validar: mcProc.input(validarCertDefInput).mutation(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    const rows = await ctx.prisma.$queryRaw<CertDefRow[]>`
      SELECT * FROM ece.certificado_defuncion
      WHERE id = ${input.id}::uuid
        AND establecimiento_id = ${ece.establecimientoId}::uuid
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

    await ctx.prisma.$executeRaw`
      UPDATE ece.certificado_defuncion
      SET estado_workflow = 'validado',
          validado_en     = now()
      WHERE id = ${input.id}::uuid
        AND estado_workflow = 'firmado'
    `;

    return { ok: true as const, estado: "validado" };
  }),

  /**
   * DIR certifica el documento (validado → certificado) con PIN (segunda firma).
   * Art. 21 NTEC — obligatorio para copias formales.
   * Emite outbox `ece.certificado_defuncion.certificado`.
   */
  certificar: dirProc.input(certificarCertDefInput).mutation(async ({ ctx, input }) => {
    const ece = withEceContext(ctx);

    return ctx.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<CertDefRow[]>`
        SELECT * FROM ece.certificado_defuncion
        WHERE id = ${input.id}::uuid
          AND establecimiento_id = ${ece.establecimientoId}::uuid
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

      await emitDomainEvent(tx, {
        organizationId: ece.organizationId,
        eventType: "ece.certificado_defuncion.certificado",
        aggregateType: "CertificadoDefuncion",
        aggregateId: input.id,
        emittedById: ctx.user.id,
        payload: {
          certDefId: input.id,
          episodioId: cert.episodio_id,
          pacienteId: cert.paciente_id,
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
    const ece = withEceContext(ctx);

    const rows = await ctx.prisma.$queryRaw<CertDefRow[]>`
      SELECT * FROM ece.certificado_defuncion
      WHERE id = ${input.id}::uuid
        AND establecimiento_id = ${ece.establecimientoId}::uuid
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

    await ctx.prisma.$executeRaw`
      UPDATE ece.certificado_defuncion
      SET estado_workflow  = 'anulado',
          anulado_en       = now(),
          motivo_anulacion = ${input.motivoAnulacion}
      WHERE id = ${input.id}::uuid
        AND estado_workflow != 'certificado'
    `;

    return { ok: true as const, estado: "anulado" };
  }),
});
