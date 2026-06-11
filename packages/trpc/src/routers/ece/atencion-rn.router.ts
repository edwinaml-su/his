/**
 * Router tRPC — Atención Recién Nacido (NTEC Doc ATN_RN).
 *
 * Tabla: ece.atencion_recien_nacido (SQL 73)
 *
 * Workflow: ATN_RN borrador → firmado (pediatra MC con PIN electrónico).
 *
 * Procedimientos:
 *   list           — MC, ENF, ARCH, DIR listan por episodio_obs_id
 *   get            — mismo conjunto de roles
 *   create         — MC: crea registro ATN_RN + paciente RN atómicamente
 *   registrarApgar — MC: actualiza scores Apgar (solo en borrador)
 *   firmar         — MC: firma con PIN electrónico → estado firmado
 *
 * Creación atómica del paciente RN:
 *   El router crea un Patient en public con motherPatientId → madre,
 *   luego inserta ece.paciente apuntando al mismo Patient.id,
 *   y finalmente inserta ece.atencion_recien_nacido.
 *
 * Outbox events:
 *   ece.rn.registrado           — al crear
 *   ece.rn.reanimacion_requerida — al crear si reanimacion_requerida = true
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { emitDomainEvent } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withWorkflowContext } from "../../workflow/context";
import type { EceContext } from "../../workflow/context";

// =============================================================================
// Schemas Zod
// =============================================================================

const alimentacionEnum = z.enum(["lactancia_inmediata", "formula", "sng"]);

const createSchema = z.object({
  episodioObsId:                z.string().uuid(),
  pacienteMadreId:              z.string().uuid(),
  // datos paciente RN (para creación atómica)
  rnPrimerNombre:               z.string().min(1).max(100),
  rnPrimerApellido:             z.string().min(1).max(100),
  rnBiologicalSexId:            z.string().uuid(),
  rnBirthDate:                  z.coerce.date(),
  // datos clínicos
  pesoG:                        z.number().int().min(200).max(8000),
  tallaCm:                      z.number().min(20).max(70),
  perimetroCefalicoCm:          z.number().min(20).max(50).optional(),
  sexo:                         z.enum(["M", "F", "I"]),
  edadGestacionalSemanas:       z.number().int().min(20).max(45),
  apgar1min:                    z.number().int().min(0).max(10),
  apgar5min:                    z.number().int().min(0).max(10),
  apgar10min:                   z.number().int().min(0).max(10).optional(),
  reanimacionRequerida:         z.boolean().default(false),
  reanimacionProtocoloNrp:      z.boolean().default(false),
  malformacionesVisibles:       z.string().max(4000).optional(),
  alimentacionInicial:          alimentacionEnum,
});

const registrarApgarSchema = z.object({
  id:         z.string().uuid(),
  apgar1min:  z.number().int().min(0).max(10),
  apgar5min:  z.number().int().min(0).max(10),
  apgar10min: z.number().int().min(0).max(10).optional(),
});

const firmarSchema = z.object({
  id:  z.string().uuid(),
  pin: z.string().min(6).max(32),
});

const listSchema = z.object({
  episodioObsId: z.string().uuid().optional(),
  estado:        z.enum(["borrador", "firmado", "validado", "anulado"]).optional(),
  limit:         z.number().int().min(1).max(100).default(20),
});

const idSchema = z.object({ id: z.string().uuid() });

// =============================================================================
// Tipos raw SQL
// =============================================================================

export interface AtencionRnRow {
  id: string;
  episodio_obs_id: string;
  paciente_madre_id: string;
  paciente_rn_id: string;
  instancia_id: string | null;
  hora_nacimiento: Date;
  peso_g: number;
  talla_cm: string;
  perimetro_cefalico_cm: string | null;
  sexo: string;
  edad_gestacional_semanas: number;
  apgar_1min: number;
  apgar_5min: number | null;
  apgar_10min: number | null;
  reanimacion_requerida: boolean;
  reanimacion_protocolo_nrp_aplicado: unknown;
  malformaciones_visibles: string | null;
  alimentacion_inicial: string;
  estado_documento: string;
  registrado_por: string;
  atendido_por: string | null;
  firmado_por: string | null;
  firmado_en: Date | null;
  registrado_en: Date;
}

// =============================================================================
// Helpers de raw SQL
// =============================================================================

type RawTx = {
  $queryRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
  $executeRaw: (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
};

async function findAtnRn(tx: RawTx, id: string): Promise<AtencionRnRow | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<AtencionRnRow[]>)`
    SELECT
      id::text, episodio_obs_id::text, paciente_madre_id::text, paciente_rn_id::text,
      instancia_id::text, hora_nacimiento, peso_g, talla_cm, perimetro_cefalico_cm,
      sexo, edad_gestacional_semanas, apgar_1min, apgar_5min, apgar_10min,
      reanimacion_requerida, reanimacion_protocolo_nrp_aplicado, malformaciones_visibles,
      alimentacion_inicial, estado_documento, registrado_por::text, atendido_por::text,
      firmado_por::text, firmado_en, registrado_en
    FROM ece.atencion_recien_nacido
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonal(tx: RawTx, hisUserId: string): Promise<{ id: string } | null> {
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
): Promise<{ id: string; pin_hash: string; failed_attempts: number; locked_until: Date | null; revoked_at: Date | null } | null> {
  const rows = await (tx.$queryRaw as (
    tpl: TemplateStringsArray, ...args: unknown[]
  ) => Promise<Array<{ id: string; pin_hash: string; failed_attempts: number; locked_until: Date | null; revoked_at: Date | null }>>)`
    SELECT id::text, pin_hash, failed_attempts, locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

const LOCKOUT_MAX = 5;

async function verifyPin(tx: RawTx, hisUserId: string, pin: string): Promise<{ firmaId: string; personalId: string }> {
  const personal = await findPersonal(tx, hisUserId);
  if (!personal) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin perfil de personal_salud activo." });
  }
  const firma = await findFirma(tx, personal.id);
  if (!firma) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Firma electrónica no configurada." });
  }
  if (firma.locked_until && firma.locked_until > new Date()) {
    const mins = Math.ceil((firma.locked_until.getTime() - Date.now()) / 60_000);
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Firma bloqueada. Reintente en ${mins} min.` });
  }

  // Importación dinámica para permitir mock en tests sin resolución de módulo.
  const { argon2 } = await import("@his/infrastructure");
  const valid = await argon2.verify(firma.pin_hash, pin);
  if (!valid) {
    await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
      UPDATE ece.firma_electronica SET failed_attempts = failed_attempts + 1 WHERE id = ${firma.id}::uuid
    `;
    const rem = LOCKOUT_MAX - (firma.failed_attempts + 1);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: rem > 0 ? `PIN incorrecto. Intentos restantes: ${rem}.` : "PIN incorrecto. Firma bloqueada.",
    });
  }
  await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
    UPDATE ece.firma_electronica SET failed_attempts = 0 WHERE id = ${firma.id}::uuid
  `;
  return { firmaId: firma.id, personalId: personal.id };
}

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}): EceContext {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Se requiere establecimiento activo." });
  }
  return { personalId: ctx.user.id, establecimientoId: ctx.tenant.establishmentId, roles: ctx.tenant.roleCodes };
}

async function withEce<T>(
  prisma: Parameters<typeof withWorkflowContext>[0],
  ctx: EceContext,
  fn: Parameters<typeof withWorkflowContext<T>>[2],
): Promise<T> {
  return withWorkflowContext<T>(prisma, ctx, fn);
}

// =============================================================================
// Procedures
// =============================================================================

const mcProc     = requireRole(["MC"]);
const readerProc = requireRole(["MC", "ENF", "ARCH", "DIR"]);

// =============================================================================
// Router
// =============================================================================

export const eceAtencionRnRouter = router({

  /** Lista registros ATN_RN con filtro opcional por episodio y estado. */
  list: readerProc.input(listSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const rows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<AtencionRnRow[]>)`
        SELECT
          id::text, episodio_obs_id::text, paciente_madre_id::text, paciente_rn_id::text,
          instancia_id::text, hora_nacimiento, peso_g, talla_cm, perimetro_cefalico_cm,
          sexo, edad_gestacional_semanas, apgar_1min, apgar_5min, apgar_10min,
          reanimacion_requerida, malformaciones_visibles, alimentacion_inicial,
          estado_documento, registrado_por::text, atendido_por::text, firmado_en, registrado_en
        FROM ece.atencion_recien_nacido
        WHERE (${input.episodioObsId ?? null}::uuid IS NULL OR episodio_obs_id = ${input.episodioObsId ?? null}::uuid)
          AND (${input.estado ?? null}::text IS NULL OR estado_documento = ${input.estado ?? null}::text)
        ORDER BY hora_nacimiento DESC
        LIMIT ${input.limit}
      `;
      return rows;
    });
  }),

  /** Devuelve un registro ATN_RN por id. */
  get: readerProc.input(idSchema).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const row = await findAtnRn(tx, input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: `ATN_RN no encontrado: ${input.id}` });
      }
      return row;
    });
  }),

  /**
   * Crea un registro ATN_RN con creación atómica del paciente RN.
   *
   * Pasos dentro de la transacción:
   *   1. Verificar personal_salud MC activo.
   *   2. Crear Patient (public) con motherPatientId = paciente_madre_id.
   *   3. Crear ece.paciente vinculado al Patient recién creado.
   *   4. Crear instancia workflow ATN_RN.
   *   5. Insertar ece.atencion_recien_nacido.
   *   6. Emitir events outbox.
   */
  create: mcProc.input(createSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEce(ctx.prisma, eceCtx, async (tx) => {
      // 1. Personal
      const personal = await findPersonal(tx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin perfil de personal_salud activo." });
      }

      // 2. Resolver tipo documento ATN_RN + estado inicial
      const tipoDocRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
        SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
        FROM ece.tipo_documento td
        JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
        WHERE td.codigo = 'ATN_RN'
        LIMIT 1
      `;
      if (tipoDocRows.length === 0) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tipo documento ATN_RN no configurado." });
      }
      const { tipo_doc_id, estado_inicial_id } = tipoDocRows[0]!;

      // 3. Obtener paciente_madre ece para extraer organizationId del Patient público
      const madreEceRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ public_patient_id: string }>>)`
        SELECT public_patient_id::text FROM ece.paciente
        WHERE id = ${input.pacienteMadreId}::uuid
        LIMIT 1
      `;
      if (madreEceRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paciente madre no encontrada en ECE." });
      }
      const motherPublicId = madreEceRows[0]!.public_patient_id;

      // 4. Obtener organizationId de la madre (para crear Patient RN en la misma org)
      const madrePublicRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ organization_id: string }>>)`
        SELECT "organizationId"::text AS organization_id
        FROM public."Patient"
        WHERE id = ${motherPublicId}::uuid
        LIMIT 1
      `;
      if (madrePublicRows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paciente madre no encontrada en MPI público." });
      }
      const orgId = madrePublicRows[0]!.organization_id;

      // 5. Crear Patient público RN
      const mrnRn = `RN-${Date.now().toString(36).toUpperCase()}`;
      const rnPublicRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO public."Patient"
          ("organizationId", mrn, "firstName", "lastName", "birthDate",
           "birthDateEstimated", "biologicalSexId", "isUnknown", "motherPatientId", "createdBy")
        VALUES (
          ${orgId}::uuid, ${mrnRn}, ${input.rnPrimerNombre}, ${input.rnPrimerApellido},
          ${input.rnBirthDate.toISOString()}::timestamptz,
          false, ${input.rnBiologicalSexId}::uuid, false,
          ${motherPublicId}::uuid, ${ctx.user.id}::uuid
        )
        RETURNING id::text
      `;
      const rnPublicId = rnPublicRows[0]!.id;

      // 6. Crear ece.paciente RN
      // NOT NULL requeridos: public_patient_id, establecimiento_id, numero_expediente
      // tipo_registro_identidad y estado_* tienen defaults en la tabla pero los
      // especificamos para claridad. MRN se genera con el mismo patrón de ece-hooks.
      const mrnRnEce = `RN-${rnPublicId.substring(0, 8).toUpperCase()}`;
      const rnEceRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.paciente (
          public_patient_id,
          establecimiento_id,
          numero_expediente,
          tipo_registro_identidad
        )
        VALUES (
          ${rnPublicId}::uuid,
          ${eceCtx.establecimientoId}::uuid,
          ${mrnRnEce},
          'sin_documento'
        )
        RETURNING id::text
      `;
      const rnEceId = rnEceRows[0]!.id;

      // 7. Crear instancia workflow
      const instanciaRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.documento_instancia
          (tipo_documento_id, paciente_id, estado_actual_id, creado_por)
        VALUES (
          ${tipo_doc_id}::uuid,
          ${rnEceId}::uuid,
          ${estado_inicial_id}::uuid,
          ${personal.id}::uuid
        )
        RETURNING id::text
      `;
      const instanciaId = instanciaRows[0]!.id;

      // sexo: el CHECK de la tabla exige 'masculino'|'femenino'|'indeterminado'.
      // El input acepta 'M'|'F'|'I' por compatibilidad con el formulario HIS.
      const sexoMap: Record<string, string> = { M: "masculino", F: "femenino", I: "indeterminado" };
      const sexoEce = sexoMap[input.sexo] ?? "indeterminado";

      // 8. Insertar atencion_recien_nacido
      const atnRows = await (tx.$queryRaw as (
        tpl: TemplateStringsArray, ...args: unknown[]
      ) => Promise<Array<{ id: string }>>)`
        INSERT INTO ece.atencion_recien_nacido (
          episodio_obs_id, instancia_id, paciente_madre_id, paciente_rn_id,
          peso_g, talla_cm, perimetro_cefalico_cm, sexo, edad_gestacional_semanas,
          apgar_1min, apgar_5min, apgar_10min,
          reanimacion_requerida, reanimacion_protocolo_nrp_aplicado,
          malformaciones_visibles, alimentacion_inicial,
          registrado_por, atendido_por, estado_documento
        ) VALUES (
          ${input.episodioObsId}::uuid,
          ${instanciaId}::uuid,
          ${input.pacienteMadreId}::uuid,
          ${rnEceId}::uuid,
          ${input.pesoG},
          ${input.tallaCm},
          ${input.perimetroCefalicoCm ?? null},
          ${sexoEce},
          ${input.edadGestacionalSemanas},
          ${input.apgar1min},
          ${input.apgar5min},
          ${input.apgar10min ?? null},
          ${input.reanimacionRequerida},
          ${JSON.stringify({ aplicado: input.reanimacionProtocoloNrp })}::jsonb,
          ${input.malformacionesVisibles ?? null},
          ${input.alimentacionInicial},
          ${personal.id}::uuid,
          ${personal.id}::uuid,
          'borrador'
        )
        RETURNING id::text
      `;
      const atnId = atnRows[0]!.id;

      // 9. Outbox: ece.rn.registrado
      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.rn.registrado",
        aggregateType: "AtencionRN",
        aggregateId: atnId,
        emittedById: ctx.user.id,
        payload: {
          atnRnId: atnId,
          rnPatientId: rnEceId,
          madrePatientId: input.pacienteMadreId,
          episodioObsId: input.episodioObsId,
          apgar1min: input.apgar1min,
          apgar5min: input.apgar5min,
        },
      });

      // 10. Outbox condicional: ece.rn.reanimacion_requerida
      if (input.reanimacionRequerida) {
        await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.rn.reanimacion_requerida",
          aggregateType: "AtencionRN",
          aggregateId: atnId,
          emittedById: ctx.user.id,
          payload: {
            atnRnId: atnId,
            rnPatientId: rnEceId,
            protocoloNrp: input.reanimacionProtocoloNrp,
          },
        });
      }

      return { ok: true as const, id: atnId, pacienteRnId: rnEceId, instanciaId };
    });
  }),

  /** Actualiza solo los scores Apgar (solo en estado borrador). */
  registrarApgar: mcProc.input(registrarApgarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const row = await findAtnRn(tx, input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: `ATN_RN no encontrado: ${input.id}` });
      }
      if (row.estado_documento !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede actualizar Apgar en borrador (actual: ${row.estado_documento}).`,
        });
      }
      await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
        UPDATE ece.atencion_recien_nacido SET
          apgar_1min  = ${input.apgar1min},
          apgar_5min  = ${input.apgar5min},
          apgar_10min = ${input.apgar10min ?? null}
        WHERE id = ${input.id}::uuid
      `;
      return { ok: true as const };
    });
  }),

  /**
   * Firma el registro ATN_RN con PIN del pediatra MC.
   * Emite outbox ece.rn.registrado con estado firmado (el evento inicial
   * ya se emitió al crear; aquí registramos la firma en el historial).
   */
  firmar: mcProc.input(firmarSchema).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    return withEce(ctx.prisma, eceCtx, async (tx) => {
      const row = await findAtnRn(tx, input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: `ATN_RN no encontrado: ${input.id}` });
      }
      if (row.estado_documento !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede firmar desde borrador (actual: ${row.estado_documento}).`,
        });
      }

      const { firmaId, personalId } = await verifyPin(tx, ctx.user.id, input.pin);

      await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
        UPDATE ece.atencion_recien_nacido SET
          estado_documento = 'firmado',
          firmado_por      = ${personalId}::uuid,
          firmado_en       = now()
        WHERE id = ${input.id}::uuid
      `;

      // Actualizar instancia workflow si existe
      if (row.instancia_id) {
        const transRows = await (tx.$queryRaw as (
          tpl: TemplateStringsArray, ...args: unknown[]
        ) => Promise<Array<{ estado_destino_id: string }>>)`
          SELECT ft.estado_destino_id::text
          FROM ece.flujo_transicion ft
          JOIN ece.flujo_estado fe_origen ON fe_origen.id = ft.estado_origen_id
          JOIN ece.rol r ON r.id = ft.rol_autoriza_id
          JOIN ece.documento_instancia di ON di.estado_actual_id = fe_origen.id
          WHERE di.id = ${row.instancia_id}::uuid AND ft.accion = 'firmar' AND r.codigo = 'MC'
          LIMIT 1
        `;
        if (transRows.length > 0) {
          const destino = transRows[0]!.estado_destino_id;
          await (tx.$executeRaw as (tpl: TemplateStringsArray, ...args: unknown[]) => Promise<number>)`
            UPDATE ece.documento_instancia SET estado_actual_id = ${destino}::uuid, version = version + 1
            WHERE id = ${row.instancia_id}::uuid
          `;
        }
      }

      await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
        organizationId: ctx.tenant.organizationId,
        eventType: "ece.rn.firmado",
        aggregateType: "AtencionRN",
        aggregateId: row.id,
        emittedById: ctx.user.id,
        payload: { atnRnId: row.id, firmaId, firmadoPor: personalId },
      });

      return { ok: true as const, firmadoEn: new Date().toISOString() };
    });
  }),
});
