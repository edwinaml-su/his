/**
 * eceHistoriaClinica — CRUD + workflow de ece.historia_clinica.
 *
 * Tabla operada: ece.historia_clinica (schema ECE, raw SQL — sin modelo Prisma).
 * Schema real (61_ece_06_documentos.sql):
 *   - antecedentes JSONB, examen_fisico JSONB, diagnosticos JSONB
 *   - estado vive en ece.documento_instancia (via instancia_id)
 *   - patient: instancia_id → episodio_id → ece.episodio_atencion.paciente_id
 *              → ece.paciente.public_patient_id → public."Patient"
 *
 * Workflow: HIST_CLIN con estados borrador → en_revision → firmado → validado → anulado.
 *
 * Autorización:
 *   - Lectura:  PHYSICIAN, NURSE, MC, MT, DIR
 *   - Escritura (create/update): MC, MT, DIR
 *   - firmar:   MC (Médico certificador)
 *   - validar:  DIR
 *   - enviarRevision / anular: MC, MT, DIR
 *
 * Toda transición registra en ece.documento_instancia_historial con sha256(payload).
 *
 * Spec: TDR §6 / Doc 2 NTEC / docs/backlog/fase2/
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import { Prisma } from "@his/database";
// Schemas inline — la copia canónica vive en packages/contracts/src/schemas/ece-historia-clinica.ts
// (el worktree no comparte node_modules con el monorepo principal, por eso no se importa desde allí).
const historiaClinicaListInput = z.object({
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const historiaClinicaGetInput = z.object({
  id: z.string().uuid(),
});

const historiaClinicaCreateInput = z.object({
  pacienteId: z.string().uuid(),
  episodioId: z.string().uuid().optional(),
  motivoConsulta: z.string().min(1).max(2000),
  antecedentes: z.string().max(5000).optional(),
  planInicial: z.string().max(5000).optional(),
});

const historiaClinicaUpdateInput = z.object({
  id: z.string().uuid(),
  motivoConsulta: z.string().min(1).max(2000).optional(),
  antecedentes: z.string().max(5000).optional(),
  planInicial: z.string().max(5000).optional(),
});

const historiaClinicaTransitionInput = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid().optional(),
  observacion: z.string().max(1000).optional(),
});
import type { EceContext } from "../../workflow/context";

// ─── Tipos de fila raw (interno) ─────────────────────────────────────────────

export interface HistoriaClinicaRow {
  id: string;
  paciente_id: string;
  episodio_id: string | null;
  motivo_consulta: string;
  antecedentes: string | null;
  plan_inicial: string | null;
  estado: string;
  instancia_id: string | null;
  creado_por: string;
  creado_en: Date;
  actualizado_en: Date;
}

// ─── Zod output schemas ───────────────────────────────────────────────────────

const patientSchema = z
  .object({
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    mrn: z.string().nullable(),
  })
  .nullable();

const signosVitalesSchema = z
  .object({
    paSistolica: z.number().nullable(),
    paDiastolica: z.number().nullable(),
    frecuenciaCardiaca: z.number().nullable(),
    frecuenciaRespiratoria: z.number().nullable(),
    temperatura: z.number().nullable(),
    tomadoEn: z.date(),
  })
  .nullable();

const diagnosticoItemSchema = z.object({
  codigoCie10: z.string(),
  descripcion: z.string(),
});

export const historiaClinicaGetOutput = z.object({
  id: z.string().uuid(),
  episodioId: z.string().uuid().nullable(),
  motivoConsulta: z.string(),
  antecedentes: z.string().nullable(),
  planInicial: z.string().nullable(),
  estado: z.string(),
  instanciaId: z.string().uuid().nullable(),
  createdAt: z.date(),
  firmadoEn: z.date().nullable(),
  validadoEn: z.date().nullable(),
  patient: patientSchema,
  signosVitales: signosVitalesSchema,
  diagnosticos: z.array(diagnosticoItemSchema),
  hallazgosAparato: z.string().nullable(),
  planTerapeutico: z.string().nullable(),
});

export type HistoriaClinicaGetOutput = z.infer<typeof historiaClinicaGetOutput>;

export const historiaClinicaListItemOutput = z.object({
  id: z.string().uuid(),
  estado: z.string(),
  motivoConsulta: z.string(),
  createdAt: z.date(),
  patient: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
    })
    .nullable(),
});

export type HistoriaClinicaListItemOutput = z.infer<typeof historiaClinicaListItemOutput>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertFound<T>(row: T | undefined | null, label: string): T {
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: `${label} no encontrada.` });
  }
  return row;
}

/** Construye EceContext a partir del contexto tRPC. */
function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string; roleCodes: string[] };
}): EceContext {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar Historia Clínica ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

/** sha256 del payload JSON serializado — se computa en SQL para evitar deps de crypto en edge. */
const SHA256_SQL = (payload: string): ReturnType<typeof Prisma.sql> =>
  Prisma.sql`encode(digest(${payload}, 'sha256'), 'hex')`;

/**
 * Registra una transición en ece.documento_instancia + ece.documento_instancia_historial.
 * Lanza CONFLICT si el estado actual no coincide con `estadoEsperado`.
 */
async function registrarTransicion(
  tx: Prisma.TransactionClient,
  opts: {
    historiaId: string;
    estadoEsperado: string;
    estadoNuevo: string;
    accion: string;
    ejecutadoPor: string;
    firmaId?: string;
    observacion?: string;
  },
): Promise<HistoriaClinicaRow> {
  // Leer estado actual + instancia_id
  const current = await tx.$queryRaw<{ estado: string; instancia_id: string | null }[]>(
    Prisma.sql`
      SELECT estado, instancia_id::text
      FROM ece.historia_clinica
      WHERE id = ${opts.historiaId}::uuid
      LIMIT 1
    `,
  );

  const row = assertFound(current[0], "HistoriaClinica");

  if (row.estado !== opts.estadoEsperado) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Estado actual '${row.estado}' no permite la acción '${opts.accion}'. Se esperaba '${opts.estadoEsperado}'.`,
    });
  }

  // UPDATE historia_clinica
  const updated = await tx.$queryRaw<HistoriaClinicaRow[]>(
    Prisma.sql`
      UPDATE ece.historia_clinica
      SET estado = ${opts.estadoNuevo}, actualizado_en = now()
      WHERE id = ${opts.historiaId}::uuid
      RETURNING
        id::text,
        paciente_id::text,
        episodio_id::text,
        motivo_consulta,
        antecedentes,
        plan_inicial,
        estado,
        instancia_id::text,
        creado_por::text,
        creado_en,
        actualizado_en
    `,
  );

  const updatedRow = assertFound(updated[0], "HistoriaClinica actualizada");

  // Construir payload para hash
  const payload = JSON.stringify({
    historiaId: opts.historiaId,
    estadoAnterior: opts.estadoEsperado,
    estadoNuevo: opts.estadoNuevo,
    accion: opts.accion,
    ejecutadoPor: opts.ejecutadoPor,
    ts: new Date().toISOString(),
  });

  // Registrar en instancia_historial si hay instancia ECE vinculada
  if (row.instancia_id) {
    await tx.$executeRaw(
      Prisma.sql`
        INSERT INTO ece.documento_instancia_historial
          (instancia_id, accion, ejecutado_por, firma_id, observacion, payload_hash)
        VALUES (
          ${row.instancia_id}::uuid,
          ${opts.accion},
          ${opts.ejecutadoPor}::uuid,
          ${opts.firmaId ?? null}::uuid,
          ${opts.observacion ?? null},
          ${SHA256_SQL(payload)}
        )
      `,
    );
  }

  return updatedRow;
}

// ─── Procedures base ─────────────────────────────────────────────────────────

const readBase = requireRole(["PHYSICIAN", "NURSE", "MC", "MT", "DIR"]);
const writeBase = requireRole(["MC", "MT", "DIR"]);
const mcBase = requireRole(["MC"]);
const dirBase = requireRole(["DIR"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceHistoriaClinicaRouter = router({
  /**
   * Lista historias clínicas — shape liviano (sin signos vitales ni diagnósticos).
   * Join a patient para mostrar nombre en tabla.
   */
  list: readBase.input(historiaClinicaListInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      type ListRow = {
        id: string;
        estado: string;
        motivo_consulta: string;
        creado_en: Date;
        patient_first_name: string | null;
        patient_last_name: string | null;
      };

      const rows = await tx.$queryRaw<ListRow[]>(
        Prisma.sql`
          SELECT
            hc.id::text,
            hc.estado,
            hc.motivo_consulta,
            hc.creado_en,
            p."firstName"  AS patient_first_name,
            p."lastName"   AS patient_last_name
          FROM ece.historia_clinica hc
          LEFT JOIN ece.episodio_atencion ea  ON ea.id = hc.episodio_id
          LEFT JOIN ece.paciente ep           ON ep.id = ea.paciente_id
          LEFT JOIN public."Patient" p        ON p.id  = ep.public_patient_id
          WHERE
            (${input.pacienteId ?? null}::uuid IS NULL
              OR ea.paciente_id = ${input.pacienteId ?? null}::uuid)
            AND (${input.episodioId ?? null}::uuid IS NULL
              OR hc.episodio_id = ${input.episodioId ?? null}::uuid)
            AND (${input.cursor ?? null}::uuid IS NULL
              OR hc.id > ${input.cursor ?? null}::uuid)
          ORDER BY hc.id ASC
          LIMIT ${input.limit + 1}
        `,
      );

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]!.id : null;

      const mapped: HistoriaClinicaListItemOutput[] = items.map((r) => ({
        id: r.id,
        estado: r.estado,
        motivoConsulta: r.motivo_consulta,
        createdAt: r.creado_en,
        patient:
          r.patient_first_name != null
            ? { firstName: r.patient_first_name, lastName: r.patient_last_name ?? "" }
            : null,
      }));

      return { items: mapped, nextCursor };
    });
  }),

  /** Obtiene una historia clínica por id con shape extendido. */
  get: readBase.input(historiaClinicaGetInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      type GetRow = {
        id: string;
        episodio_id: string | null;
        motivo_consulta: string;
        antecedentes: string | null;
        plan_inicial: string | null;
        estado: string;
        instancia_id: string | null;
        creado_en: Date;
        firmado_en: Date | null;
        validado_en: Date | null;
        patient_id: string | null;
        patient_first_name: string | null;
        patient_last_name: string | null;
        patient_mrn: string | null;
        sv_pa_sistolica: number | null;
        sv_pa_diastolica: number | null;
        sv_frecuencia_cardiaca: number | null;
        sv_frecuencia_respiratoria: number | null;
        sv_temperatura: number | null;
        sv_tomado_en: Date | null;
        // diagnosticos y examen_fisico vienen como JSON string desde JSONB
        diagnosticos_json: string | null;
        examen_fisico_json: string | null;
      };

      const rows = await tx.$queryRaw<GetRow[]>(
        Prisma.sql`
          SELECT
            hc.id::text,
            hc.episodio_id::text,
            hc.motivo_consulta,
            -- antecedentes y plan_manejo son los campos reales del schema (61_ece_06_documentos.sql)
            -- plan_inicial es alias de compatibilidad hacia plan_manejo
            hc.antecedentes::text           AS antecedentes,
            hc.plan_manejo                  AS plan_inicial,
            hc.estado,
            hc.instancia_id::text,
            hc.registrado_en                AS creado_en,
            -- firmado_en / validado_en: extraído del historial de instancia
            (
              SELECT ih.realizado_en
              FROM ece.documento_instancia_historial ih
              WHERE ih.instancia_id = hc.instancia_id
                AND ih.accion = 'firmar'
              ORDER BY ih.realizado_en ASC
              LIMIT 1
            )                               AS firmado_en,
            (
              SELECT ih.realizado_en
              FROM ece.documento_instancia_historial ih
              WHERE ih.instancia_id = hc.instancia_id
                AND ih.accion = 'validar'
              ORDER BY ih.realizado_en ASC
              LIMIT 1
            )                               AS validado_en,
            -- patient via episodio → ece.paciente → public.Patient
            p.id::text                      AS patient_id,
            p."firstName"                   AS patient_first_name,
            p."lastName"                    AS patient_last_name,
            p."mrn"                         AS patient_mrn,
            -- últimos signos vitales del episodio
            sv.ta_sistolica                 AS sv_pa_sistolica,
            sv.ta_diastolica                AS sv_pa_diastolica,
            sv.frecuencia_cardiaca          AS sv_frecuencia_cardiaca,
            sv.frecuencia_respiratoria      AS sv_frecuencia_respiratoria,
            sv.temperatura                  AS sv_temperatura,
            sv.tomado_en                    AS sv_tomado_en,
            -- JSONB cast a text para deserializar en JS
            hc.diagnosticos::text           AS diagnosticos_json,
            hc.examen_fisico::text          AS examen_fisico_json
          FROM ece.historia_clinica hc
          LEFT JOIN ece.episodio_atencion ea  ON ea.id = hc.episodio_id
          LEFT JOIN ece.paciente ep           ON ep.id = ea.paciente_id
          LEFT JOIN public."Patient" p        ON p.id  = ep.public_patient_id
          -- última toma de signos vitales del episodio (LATERAL equivalente via subquery correlada)
          LEFT JOIN LATERAL (
            SELECT ta_sistolica, ta_diastolica, frecuencia_cardiaca,
                   frecuencia_respiratoria, temperatura, tomado_en
            FROM ece.signos_vitales
            WHERE episodio_id = hc.episodio_id
            ORDER BY tomado_en DESC
            LIMIT 1
          ) sv ON true
          WHERE hc.id = ${input.id}::uuid
          LIMIT 1
        `,
      );

      const raw = assertFound(rows[0], "HistoriaClinica");

      // Parsear JSONB diagnosticos → [{cie10, descripcion, tipo}]
      type DiagnosticoJsonItem = { cie10?: string; descripcion?: string };
      let diagnosticos: HistoriaClinicaGetOutput["diagnosticos"] = [];
      if (raw.diagnosticos_json) {
        try {
          const parsed = JSON.parse(raw.diagnosticos_json) as DiagnosticoJsonItem[];
          diagnosticos = Array.isArray(parsed)
            ? parsed
                .filter((d) => d.cie10 && d.descripcion)
                .map((d) => ({ codigoCie10: d.cie10!, descripcion: d.descripcion! }))
            : [];
        } catch {
          // JSON malformado — degradar silenciosamente
          diagnosticos = [];
        }
      }

      // Parsear examen_fisico → hallazgosAparato (primer hallazgo de sistemas como texto)
      type ExamenFisicoJson = { sistemas?: Array<{ sistema?: string; hallazgo?: string }> };
      let hallazgosAparato: string | null = null;
      if (raw.examen_fisico_json) {
        try {
          const ef = JSON.parse(raw.examen_fisico_json) as ExamenFisicoJson;
          if (ef.sistemas?.length) {
            hallazgosAparato = ef.sistemas
              .filter((s) => s.hallazgo)
              .map((s) => `${s.sistema ?? ""}: ${s.hallazgo ?? ""}`.trim())
              .join("\n") || null;
          }
        } catch {
          // degradar silenciosamente
        }
      }

      const result: HistoriaClinicaGetOutput = {
        id: raw.id,
        episodioId: raw.episodio_id,
        motivoConsulta: raw.motivo_consulta,
        antecedentes: raw.antecedentes,
        planInicial: raw.plan_inicial,
        estado: raw.estado,
        instanciaId: raw.instancia_id,
        createdAt: raw.creado_en,
        firmadoEn: raw.firmado_en,
        validadoEn: raw.validado_en,
        patient:
          raw.patient_id != null
            ? {
                id: raw.patient_id,
                firstName: raw.patient_first_name ?? "",
                lastName: raw.patient_last_name ?? "",
                mrn: raw.patient_mrn,
              }
            : null,
        signosVitales:
          raw.sv_tomado_en != null
            ? {
                paSistolica: raw.sv_pa_sistolica,
                paDiastolica: raw.sv_pa_diastolica,
                frecuenciaCardiaca: raw.sv_frecuencia_cardiaca,
                frecuenciaRespiratoria: raw.sv_frecuencia_respiratoria,
                temperatura: raw.sv_temperatura,
                tomadoEn: raw.sv_tomado_en,
              }
            : null,
        diagnosticos,
        hallazgosAparato,
        // TODO: planTerapeutico no tiene columna dedicada aún — viene de plan_manejo
        // cuando se agregue la columna, actualizar la query y quitar este alias.
        planTerapeutico: raw.plan_inicial,
      };

      return historiaClinicaGetOutput.parse(result);
    });
  }),

  /**
   * Crea una historia clínica en estado 'borrador'.
   * El workflow_instance se crea por separado (workflow.instance.create con tipo HIST_CLIN).
   */
  create: writeBase.input(historiaClinicaCreateInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          INSERT INTO ece.historia_clinica
            (paciente_id, episodio_id, motivo_consulta, antecedentes, plan_inicial, estado, creado_por)
          VALUES (
            ${input.pacienteId}::uuid,
            ${input.episodioId ?? null}::uuid,
            ${input.motivoConsulta},
            ${input.antecedentes ?? null},
            ${input.planInicial ?? null},
            'borrador',
            ${eceCtx.personalId}::uuid
          )
          RETURNING
            id::text,
            paciente_id::text,
            episodio_id::text,
            motivo_consulta,
            antecedentes,
            plan_inicial,
            estado,
            instancia_id::text,
            creado_por::text,
            creado_en,
            actualizado_en
        `,
      );

      return assertFound(rows[0], "HistoriaClinica recién creada");
    });
  }),

  /**
   * Actualiza campos de la historia clínica.
   * Solo permitido en estado 'borrador' o 'en_revision'.
   */
  update: writeBase.input(historiaClinicaUpdateInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      // Verificar existencia y estado editable
      const current = await tx.$queryRaw<{ estado: string }[]>(
        Prisma.sql`SELECT estado FROM ece.historia_clinica WHERE id = ${input.id}::uuid LIMIT 1`,
      );
      const cur = assertFound(current[0], "HistoriaClinica");

      if (cur.estado !== "borrador" && cur.estado !== "en_revision") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La historia clínica en estado '${cur.estado}' no puede editarse. Solo en borrador o en_revision.`,
        });
      }

      const updates: ReturnType<typeof Prisma.sql>[] = [Prisma.sql`actualizado_en = now()`];
      if (input.motivoConsulta !== undefined)
        updates.push(Prisma.sql`motivo_consulta = ${input.motivoConsulta}`);
      if (input.antecedentes !== undefined)
        updates.push(Prisma.sql`antecedentes = ${input.antecedentes}`);
      if (input.planInicial !== undefined)
        updates.push(Prisma.sql`plan_inicial = ${input.planInicial}`);

      const setFragment = Prisma.join(updates, ", ");

      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          UPDATE ece.historia_clinica
          SET ${setFragment}
          WHERE id = ${input.id}::uuid
          RETURNING
            id::text,
            paciente_id::text,
            episodio_id::text,
            motivo_consulta,
            antecedentes,
            plan_inicial,
            estado,
            instancia_id::text,
            creado_por::text,
            creado_en,
            actualizado_en
        `,
      );

      return assertFound(rows[0], "HistoriaClinica");
    });
  }),

  /** Avanza de 'borrador' → 'en_revision'. Roles: MC, MT, DIR. */
  enviarRevision: writeBase
    .input(historiaClinicaTransitionInput)
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
        return registrarTransicion(tx as unknown as Prisma.TransactionClient, {
          historiaId: input.id,
          estadoEsperado: "borrador",
          estadoNuevo: "en_revision",
          accion: "enviar_revision",
          ejecutadoPor: eceCtx.personalId,
          observacion: input.observacion,
        });
      });
    }),

  /** Avanza de 'en_revision' → 'firmado'. Solo rol MC. Requiere firmaId. */
  firmar: mcBase.input(historiaClinicaTransitionInput).mutation(async ({ ctx, input }) => {
    if (!input.firmaId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "La acción 'firmar' requiere firmaId (firma electrónica).",
      });
    }

    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      return registrarTransicion(tx as unknown as Prisma.TransactionClient, {
        historiaId: input.id,
        estadoEsperado: "en_revision",
        estadoNuevo: "firmado",
        accion: "firmar",
        ejecutadoPor: eceCtx.personalId,
        firmaId: input.firmaId,
        observacion: input.observacion,
      });
    });
  }),

  /** Avanza de 'firmado' → 'validado'. Solo rol DIR. Requiere firmaId. */
  validar: dirBase.input(historiaClinicaTransitionInput).mutation(async ({ ctx, input }) => {
    if (!input.firmaId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "La acción 'validar' requiere firmaId (firma electrónica).",
      });
    }

    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      return registrarTransicion(tx as unknown as Prisma.TransactionClient, {
        historiaId: input.id,
        estadoEsperado: "firmado",
        estadoNuevo: "validado",
        accion: "validar",
        ejecutadoPor: eceCtx.personalId,
        firmaId: input.firmaId,
        observacion: input.observacion,
      });
    });
  }),

  /**
   * Anula la historia clínica desde cualquier estado no terminal.
   * Roles: MC, MT, DIR. Requiere observacion (Art. 53 NTEC).
   */
  anular: writeBase
    .input(
      historiaClinicaTransitionInput.extend({
        observacion: z.string().min(10).max(1000),
        estadoActual: z.enum(["borrador", "en_revision", "firmado", "validado"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const eceCtx = buildEceCtx(ctx);

      return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
        return registrarTransicion(tx as unknown as Prisma.TransactionClient, {
          historiaId: input.id,
          estadoEsperado: input.estadoActual,
          estadoNuevo: "anulado",
          accion: "anular",
          ejecutadoPor: eceCtx.personalId,
          observacion: input.observacion,
        });
      });
    }),
});
