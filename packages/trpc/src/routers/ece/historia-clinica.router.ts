/**
 * Router tRPC — ECE Historia Clínica (HIST_CLIN).
 *
 * Documento NTEC: Doc 2 — Historia Clínica del Paciente.
 * Norma: TDR §6 / MINSAL Acuerdo n.° 1616 (2024), §3.2.
 * Código de tipo_documento: HIST_CLIN.
 *
 * ---------------------------------------------------------------------------
 * COLUMNAS BD REALES (ece.historia_clinica — 61_ece_06_documentos.sql)
 * ---------------------------------------------------------------------------
 *   id uuid PK, instancia_id uuid, episodio_id uuid NOT NULL,
 *   tipo_consulta text NOT NULL, motivo_consulta text, enfermedad_actual text,
 *   disposicion text, plan_manejo text, antecedentes jsonb,
 *   examen_fisico jsonb, diagnosticos jsonb,
 *   registrado_por uuid NOT NULL, registrado_en timestamptz,
 *   estado_registro text NOT NULL DEFAULT 'vigente'
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (estado_registro en la propia tabla)
 * ---------------------------------------------------------------------------
 *   borrador → firmado  (PHYSICIAN/MC: firma con SHA-256)
 *   firmado  → validado (DIR)
 *   firmado  → anulado  (DIR, pre-validado)
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get       → PHYSICIAN, NURSE, MC, MT, DIR
 *   create, update  → PHYSICIAN, MC, MT, DIR
 *   firmar          → PHYSICIAN, MC
 *   validar         → DIR
 *
 * Raw SQL obligatorio — ece.* no está en schema.prisma.
 * HC-001, HC-002: este router cubre la ausencia total de CRUD para historia_clinica.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import { validateClinicalText } from "@his/contracts/clinical/forbidden-abbreviations";

// ---------------------------------------------------------------------------
// Enum NTEC tipo_consulta (MINSAL Acuerdo n.° 1616 Art. 7)
// ---------------------------------------------------------------------------
const TIPO_CONSULTA = ["ingreso", "control", "urgencia", "ambulatoria", "interconsulta"] as const;
const tipoConsultaEnum = z.enum(TIPO_CONSULTA);

const DISPOSICION_OPTIONS = ["ALTA", "INTERNAMIENTO", "REFERENCIA", "OBSERVACION"] as const;

// ---------------------------------------------------------------------------
// Schemas de input
// ---------------------------------------------------------------------------

const icd10DiagnosticoSchema = z.object({
  code: z.string().regex(/^[A-Z]\d{2}(\.\d+)?$/, "Código CIE-10 inválido"),
  description: z.string().min(1).max(500),
  tipo: z.enum(["principal", "secundario"]).default("secundario"),
});
type Icd10Diagnostico = z.infer<typeof icd10DiagnosticoSchema>;

const antecedentesSchema = z.object({
  personales: z.string().max(4000).optional(),
  familiares: z.string().max(4000).optional(),
  sociales: z.string().max(4000).optional(),
  alergias: z.string().max(2000).optional(),
}).optional();

const examenFisicoSchema = z.object({
  sistemas: z.array(z.object({
    sistema: z.string().max(100),
    hallazgo: z.string().max(2000),
  })).optional(),
  signosVitales: z.object({
    paSistolica: z.number().int().min(50).max(300).optional(),
    paDiastolica: z.number().int().min(30).max(200).optional(),
    frecuenciaCardiaca: z.number().int().min(20).max(300).optional(),
    frecuenciaRespiratoria: z.number().int().min(4).max(60).optional(),
    temperatura: z.number().min(30).max(45).optional(),
  }).optional(),
}).optional();

const listInput = z.object({
  episodioId: z.string().uuid().optional(),
  estado: z.enum(["borrador", "firmado", "validado", "anulado"]).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const getInput = z.object({ id: z.string().uuid() });

const createInput = z.object({
  episodioId: z.string().uuid(),
  instanciaId: z.string().uuid().optional(),
  tipoConsulta: tipoConsultaEnum,
  motivoConsulta: z.string().min(1).max(2000).optional(),
  enfermedadActual: z.string().max(4000).optional(),
  disposicion: z.enum(DISPOSICION_OPTIONS).optional(),
  planManejo: z.string().max(5000).optional(),
  antecedentes: antecedentesSchema,
  examenFisico: examenFisicoSchema,
  /** HC-004: diagnósticos CIE-10 validados en borde de aplicación */
  diagnosticos: z.array(icd10DiagnosticoSchema).optional(),
});

const updateInput = z.object({
  id: z.string().uuid(),
  tipoConsulta: tipoConsultaEnum.optional(),
  motivoConsulta: z.string().min(1).max(2000).optional(),
  enfermedadActual: z.string().max(4000).optional(),
  disposicion: z.enum(DISPOSICION_OPTIONS).optional(),
  planManejo: z.string().max(5000).optional(),
  antecedentes: antecedentesSchema,
  examenFisico: examenFisicoSchema,
  /** HC-004: diagnósticos CIE-10 validados en borde de aplicación */
  diagnosticos: z.array(icd10DiagnosticoSchema).optional(),
});

const transitionInput = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid().optional(),
  observacion: z.string().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// Tipos de fila raw — alineados con columnas BD reales
// ---------------------------------------------------------------------------

export interface HistoriaClinicaRow {
  id: string;
  instancia_id: string | null;
  episodio_id: string;
  tipo_consulta: string;
  motivo_consulta: string | null;
  enfermedad_actual: string | null;
  disposicion: string | null;
  plan_manejo: string | null;
  antecedentes: unknown;
  examen_fisico: unknown;
  diagnosticos: unknown;
  registrado_por: string;
  registrado_en: Date;
  estado_registro: string;
}

// ---------------------------------------------------------------------------
// Output schemas Zod
// ---------------------------------------------------------------------------

export const historiaClinicaListItemOutput = z.object({
  id: z.string().uuid(),
  episodioId: z.string().uuid(),
  tipoConsulta: z.string(),
  motivoConsulta: z.string().nullable(),
  estadoRegistro: z.string(),
  registradoEn: z.date(),
  patient: z.object({
    firstName: z.string(),
    lastName: z.string(),
  }).nullable(),
});
export type HistoriaClinicaListItemOutput = z.infer<typeof historiaClinicaListItemOutput>;

export const historiaClinicaGetOutput = z.object({
  id: z.string().uuid(),
  instanciaId: z.string().uuid().nullable(),
  episodioId: z.string().uuid(),
  tipoConsulta: z.string(),
  motivoConsulta: z.string().nullable(),
  enfermedadActual: z.string().nullable(),
  disposicion: z.string().nullable(),
  planManejo: z.string().nullable(),
  antecedentes: z.unknown().nullable(),
  examenFisico: z.unknown().nullable(),
  diagnosticos: z.array(icd10DiagnosticoSchema),
  registradoPor: z.string().uuid(),
  registradoEn: z.date(),
  estadoRegistro: z.string(),
  patient: z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    mrn: z.string().nullable(),
  }).nullable(),
  firmadoEn: z.date().nullable(),
  validadoEn: z.date().nullable(),
});
export type HistoriaClinicaGetOutput = z.infer<typeof historiaClinicaGetOutput>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertFound<T>(row: T | undefined | null, label: string): T {
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: `${label} no encontrada.` });
  }
  return row;
}

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}) {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar Historia Clínica ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
  };
}

/** Parsea el JSONB de diagnosticos a array tipado; degrada silenciosamente a []. */
function parseDiagnosticos(raw: unknown): Icd10Diagnostico[] {
  if (!raw) return [];
  try {
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);
    const parsed = JSON.parse(str) as unknown[];
    if (!Array.isArray(parsed)) return [];
    const result: Icd10Diagnostico[] = [];
    for (const item of parsed) {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const code = String(obj.code ?? "");
        const description = String(obj.description ?? "");
        const tipo = (obj.tipo === "principal" ? "principal" : "secundario") as "principal" | "secundario";
        if (code && description) {
          result.push({ code, description, tipo });
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Role bases
// ---------------------------------------------------------------------------

const readBase = requireRole(["PHYSICIAN", "NURSE", "MC", "MT", "DIR"]);
const writeBase = requireRole(["PHYSICIAN", "MC", "MT", "DIR"]);
const firmaBase = requireRole(["PHYSICIAN", "MC"]);
const dirBase = requireRole(["DIR"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eceHistoriaClinicaRouter = router({
  /**
   * Lista historias clínicas del episodio — shape liviano.
   * HC-001, HC-002: expone las historias que antes no eran accesibles.
   */
  list: readBase.input(listInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      type ListRow = {
        id: string;
        episodio_id: string;
        tipo_consulta: string;
        motivo_consulta: string | null;
        estado_registro: string;
        registrado_en: Date;
        patient_first_name: string | null;
        patient_last_name: string | null;
      };

      const rows = await tx.$queryRaw<ListRow[]>(
        Prisma.sql`
          SELECT
            hc.id::text,
            hc.episodio_id::text,
            hc.tipo_consulta,
            hc.motivo_consulta,
            hc.estado_registro,
            hc.registrado_en,
            p."firstName"  AS patient_first_name,
            p."lastName"   AS patient_last_name
          FROM ece.historia_clinica hc
          LEFT JOIN ece.episodio_atencion ea  ON ea.id = hc.episodio_id
          LEFT JOIN ece.paciente ep           ON ep.id = ea.paciente_id
          LEFT JOIN public."Patient" p        ON p.id  = ep.public_patient_id
          WHERE
            (${input.episodioId ?? null}::uuid IS NULL
              OR hc.episodio_id = ${input.episodioId ?? null}::uuid)
            AND (${input.estado ?? null}::text IS NULL
              OR hc.estado_registro = ${input.estado ?? null}::text)
            AND (${input.cursor ?? null}::uuid IS NULL
              OR hc.id > ${input.cursor ?? null}::uuid)
          ORDER BY hc.registrado_en DESC, hc.id ASC
          LIMIT ${input.limit + 1}
        `,
      );

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]!.id : null;

      const mapped: HistoriaClinicaListItemOutput[] = items.map((r) => ({
        id: r.id,
        episodioId: r.episodio_id,
        tipoConsulta: r.tipo_consulta,
        motivoConsulta: r.motivo_consulta,
        estadoRegistro: r.estado_registro,
        registradoEn: r.registrado_en,
        patient:
          r.patient_first_name != null
            ? { firstName: r.patient_first_name, lastName: r.patient_last_name ?? "" }
            : null,
      }));

      return { items: mapped, nextCursor };
    });
  }),

  /** Detalle completo de una historia clínica por ID. */
  get: readBase.input(getInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      type GetRow = {
        id: string;
        instancia_id: string | null;
        episodio_id: string;
        tipo_consulta: string;
        motivo_consulta: string | null;
        enfermedad_actual: string | null;
        disposicion: string | null;
        plan_manejo: string | null;
        antecedentes: unknown;
        examen_fisico: unknown;
        diagnosticos: unknown;
        registrado_por: string;
        registrado_en: Date;
        estado_registro: string;
        patient_id: string | null;
        patient_first_name: string | null;
        patient_last_name: string | null;
        patient_mrn: string | null;
        firmado_en: Date | null;
        validado_en: Date | null;
      };

      const rows = await tx.$queryRaw<GetRow[]>(
        Prisma.sql`
          SELECT
            hc.id::text,
            hc.instancia_id::text,
            hc.episodio_id::text,
            hc.tipo_consulta,
            hc.motivo_consulta,
            hc.enfermedad_actual,
            hc.disposicion,
            hc.plan_manejo,
            hc.antecedentes,
            hc.examen_fisico,
            hc.diagnosticos,
            hc.registrado_por::text,
            hc.registrado_en,
            hc.estado_registro,
            p.id::text            AS patient_id,
            p."firstName"         AS patient_first_name,
            p."lastName"          AS patient_last_name,
            p."mrn"               AS patient_mrn,
            (
              SELECT ih.realizado_en
              FROM ece.documento_instancia_historial ih
              WHERE ih.instancia_id = hc.instancia_id
                AND ih.accion = 'firmar'
              ORDER BY ih.realizado_en ASC
              LIMIT 1
            )                     AS firmado_en,
            (
              SELECT ih.realizado_en
              FROM ece.documento_instancia_historial ih
              WHERE ih.instancia_id = hc.instancia_id
                AND ih.accion = 'validar'
              ORDER BY ih.realizado_en ASC
              LIMIT 1
            )                     AS validado_en
          FROM ece.historia_clinica hc
          LEFT JOIN ece.episodio_atencion ea ON ea.id = hc.episodio_id
          LEFT JOIN ece.paciente ep          ON ep.id = ea.paciente_id
          LEFT JOIN public."Patient" p       ON p.id  = ep.public_patient_id
          WHERE hc.id = ${input.id}::uuid
          LIMIT 1
        `,
      );

      const raw = assertFound(rows[0], "HistoriaClinica");

      const result: HistoriaClinicaGetOutput = {
        id: raw.id,
        instanciaId: raw.instancia_id,
        episodioId: raw.episodio_id,
        tipoConsulta: raw.tipo_consulta,
        motivoConsulta: raw.motivo_consulta,
        enfermedadActual: raw.enfermedad_actual,
        disposicion: raw.disposicion,
        planManejo: raw.plan_manejo,
        antecedentes: raw.antecedentes ?? null,
        examenFisico: raw.examen_fisico ?? null,
        diagnosticos: parseDiagnosticos(raw.diagnosticos),
        registradoPor: raw.registrado_por,
        registradoEn: raw.registrado_en,
        estadoRegistro: raw.estado_registro,
        patient:
          raw.patient_id != null
            ? {
                id: raw.patient_id,
                firstName: raw.patient_first_name ?? "",
                lastName: raw.patient_last_name ?? "",
                mrn: raw.patient_mrn,
              }
            : null,
        firmadoEn: raw.firmado_en,
        validadoEn: raw.validado_en,
      };

      return historiaClinicaGetOutput.parse(result);
    });
  }),

  /**
   * Crea una historia clínica en estado 'borrador'.
   * HC-004: diagnosticos validados por icd10DiagnosticoSchema antes del INSERT.
   */
  create: writeBase.input(createInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      const diagnosticosJson = input.diagnosticos ? JSON.stringify(input.diagnosticos) : null;
      const antecedentesJson = input.antecedentes ? JSON.stringify(input.antecedentes) : null;
      const examenFisicoJson = input.examenFisico ? JSON.stringify(input.examenFisico) : null;

      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          INSERT INTO ece.historia_clinica
            (instancia_id, episodio_id, tipo_consulta, motivo_consulta,
             enfermedad_actual, disposicion, plan_manejo,
             antecedentes, examen_fisico, diagnosticos,
             registrado_por, estado_registro)
          VALUES (
            ${input.instanciaId ?? null}::uuid,
            ${input.episodioId}::uuid,
            ${input.tipoConsulta}::text,
            ${input.motivoConsulta ?? null},
            ${input.enfermedadActual ?? null},
            ${input.disposicion ?? null},
            ${input.planManejo ?? null},
            ${antecedentesJson ?? null}::jsonb,
            ${examenFisicoJson ?? null}::jsonb,
            ${diagnosticosJson ?? null}::jsonb,
            ${eceCtx.personalId}::uuid,
            'borrador'
          )
          RETURNING
            id::text, instancia_id::text, episodio_id::text,
            tipo_consulta, motivo_consulta, enfermedad_actual,
            disposicion, plan_manejo,
            antecedentes, examen_fisico, diagnosticos,
            registrado_por::text, registrado_en, estado_registro
        `,
      );

      return assertFound(rows[0], "HistoriaClinica recién creada");
    });
  }),

  /**
   * Actualiza una historia clínica — solo en estado 'borrador'.
   * HC-005: si está firmada, el trigger de BD rechaza el UPDATE directamente.
   */
  update: writeBase.input(updateInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      const current = await tx.$queryRaw<{ estado_registro: string }[]>(
        Prisma.sql`
          SELECT estado_registro
          FROM ece.historia_clinica
          WHERE id = ${input.id}::uuid
          LIMIT 1
        `,
      );
      const cur = assertFound(current[0], "HistoriaClinica");

      if (cur.estado_registro !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La historia clínica en estado '${cur.estado_registro}' no puede editarse. Solo en borrador.`,
        });
      }

      const sets: ReturnType<typeof Prisma.sql>[] = [];
      if (input.tipoConsulta !== undefined)
        sets.push(Prisma.sql`tipo_consulta = ${input.tipoConsulta}`);
      if (input.motivoConsulta !== undefined)
        sets.push(Prisma.sql`motivo_consulta = ${input.motivoConsulta}`);
      if (input.enfermedadActual !== undefined)
        sets.push(Prisma.sql`enfermedad_actual = ${input.enfermedadActual}`);
      if (input.disposicion !== undefined)
        sets.push(Prisma.sql`disposicion = ${input.disposicion}`);
      if (input.planManejo !== undefined)
        sets.push(Prisma.sql`plan_manejo = ${input.planManejo}`);
      if (input.antecedentes !== undefined)
        sets.push(Prisma.sql`antecedentes = ${JSON.stringify(input.antecedentes)}::jsonb`);
      if (input.examenFisico !== undefined)
        sets.push(Prisma.sql`examen_fisico = ${JSON.stringify(input.examenFisico)}::jsonb`);
      if (input.diagnosticos !== undefined)
        sets.push(Prisma.sql`diagnosticos = ${JSON.stringify(input.diagnosticos)}::jsonb`);

      if (sets.length === 0) {
        const noop = await tx.$queryRaw<HistoriaClinicaRow[]>(
          Prisma.sql`
            SELECT id::text, instancia_id::text, episodio_id::text,
              tipo_consulta, motivo_consulta, enfermedad_actual,
              disposicion, plan_manejo,
              antecedentes, examen_fisico, diagnosticos,
              registrado_por::text, registrado_en, estado_registro
            FROM ece.historia_clinica WHERE id = ${input.id}::uuid LIMIT 1
          `,
        );
        return assertFound(noop[0], "HistoriaClinica");
      }

      const setFragment = Prisma.join(sets, ", ");
      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          UPDATE ece.historia_clinica
          SET ${setFragment}
          WHERE id = ${input.id}::uuid
          RETURNING
            id::text, instancia_id::text, episodio_id::text,
            tipo_consulta, motivo_consulta, enfermedad_actual,
            disposicion, plan_manejo,
            antecedentes, examen_fisico, diagnosticos,
            registrado_por::text, registrado_en, estado_registro
        `,
      );

      return assertFound(rows[0], "HistoriaClinica");
    });
  }),

  /**
   * Transición borrador → firmado.
   * HC-005: el trigger de BD impide UPDATE/DELETE post-firma.
   */
  firmar: firmaBase.input(transitionInput).mutation(async ({ ctx, input }) => {
    if (!input.firmaId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "La acción 'firmar' requiere firmaId (firma electrónica).",
      });
    }

    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      type FirmarFetchRow = {
        estado_registro: string;
        instancia_id: string | null;
        motivo_consulta: string | null;
        enfermedad_actual: string | null;
        plan_manejo: string | null;
      };

      const current = await tx.$queryRaw<FirmarFetchRow[]>(
        Prisma.sql`
          SELECT estado_registro, instancia_id::text,
                 motivo_consulta, enfermedad_actual, plan_manejo
          FROM ece.historia_clinica WHERE id = ${input.id}::uuid LIMIT 1
        `,
      );
      const cur = assertFound(current[0], "HistoriaClinica");

      if (cur.estado_registro !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Estado '${cur.estado_registro}' no permite firma. Se esperaba 'borrador'.`,
        });
      }

      // JCI IPSG.2 ME 3 — validación abreviaciones prohibidas (warning, no bloquea)
      const textosClinicos = [
        cur.motivo_consulta ?? "",
        cur.enfermedad_actual ?? "",
        cur.plan_manejo ?? "",
      ].join(" ");
      const ipsg2 = validateClinicalText(textosClinicos);
      if (ipsg2.errors.length > 0 || ipsg2.warnings.length > 0) {
        console.warn(
          `[IPSG.2 ME 3] historia_clinica ${input.id}: ` +
            `${ipsg2.errors.length} error(es) JCI, ${ipsg2.warnings.length} warning(s)`,
        );
      }

      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          UPDATE ece.historia_clinica
          SET estado_registro = 'firmado'
          WHERE id = ${input.id}::uuid
          RETURNING
            id::text, instancia_id::text, episodio_id::text,
            tipo_consulta, motivo_consulta, enfermedad_actual,
            disposicion, plan_manejo,
            antecedentes, examen_fisico, diagnosticos,
            registrado_por::text, registrado_en, estado_registro
        `,
      );

      const updated = assertFound(rows[0], "HistoriaClinica firmada");

      // JCI IPSG.2 ME 3 — adjuntar warnings a response (no bloquea)
      const ipsg2Warnings = [...ipsg2.errors, ...ipsg2.warnings];

      // Registrar en historial de instancia si existe vínculo workflow
      if (cur.instancia_id) {
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO ece.documento_instancia_historial
              (instancia_id, accion, ejecutado_por, firma_id, observacion, payload_hash)
            VALUES (
              ${cur.instancia_id}::uuid,
              'firmar',
              ${eceCtx.personalId}::uuid,
              ${input.firmaId}::uuid,
              ${input.observacion ?? null},
              encode(digest(${input.id}, 'sha256'), 'hex')
            )
          `,
        );
      }

      return { ...updated, ipsg2Warnings };
    });
  }),

  /** Transición firmado → validado. Solo DIR. */
  validar: dirBase.input(transitionInput).mutation(async ({ ctx, input }) => {
    if (!input.firmaId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "La acción 'validar' requiere firmaId.",
      });
    }

    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      const current = await tx.$queryRaw<{ estado_registro: string; instancia_id: string | null }[]>(
        Prisma.sql`
          SELECT estado_registro, instancia_id::text
          FROM ece.historia_clinica WHERE id = ${input.id}::uuid LIMIT 1
        `,
      );
      const cur = assertFound(current[0], "HistoriaClinica");

      if (cur.estado_registro !== "firmado") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Estado '${cur.estado_registro}' no permite validación. Se esperaba 'firmado'.`,
        });
      }

      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          UPDATE ece.historia_clinica
          SET estado_registro = 'validado'
          WHERE id = ${input.id}::uuid
          RETURNING
            id::text, instancia_id::text, episodio_id::text,
            tipo_consulta, motivo_consulta, enfermedad_actual,
            disposicion, plan_manejo,
            antecedentes, examen_fisico, diagnosticos,
            registrado_por::text, registrado_en, estado_registro
        `,
      );

      const updated = assertFound(rows[0], "HistoriaClinica validada");

      if (cur.instancia_id) {
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO ece.documento_instancia_historial
              (instancia_id, accion, ejecutado_por, firma_id, observacion, payload_hash)
            VALUES (
              ${cur.instancia_id}::uuid,
              'validar',
              ${eceCtx.personalId}::uuid,
              ${input.firmaId}::uuid,
              ${input.observacion ?? null},
              encode(digest(${input.id}, 'sha256'), 'hex')
            )
          `,
        );
      }

      return updated;
    });
  }),
});
