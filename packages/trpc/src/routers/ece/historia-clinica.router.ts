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
 *   disposicion text, analisis_clinico text, plan_manejo text, antecedentes jsonb,
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
import { argon2 } from "@his/infrastructure";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import { applyTenantContext } from "../../rls-context";
import { validateClinicalText } from "@his/contracts/clinical/forbidden-abbreviations";
import {
  cie11DiagnosticoSchema,
  destinoEnum,
  antecedentesSchema,
  tieneComplementario,
  antecedentesEstructuradosSchema,
  planItemSchema,
  procedimientoCptSchema,
  terapiaRespiratoriaSchema,
  ordenExamenSchema,
  ordenInyeccionSchema,
  type Cie11Diagnostico,
  type OrdenExamen,
} from "@his/contracts";

// ---------------------------------------------------------------------------
// Enum tipo_consulta — alineado con CHECK historia_clinica_tipo_consulta_check
// Mapeo app→DDL:
//   ingreso/urgencia/ambulatoria → subsecuente (primera consulta ambulatoria)
//   primera_vez → primera_vez (primer contacto formal)
//   control/interconsulta → subsecuente (seguimiento o interconsulta)
// El input acepta los valores DDL directamente para evitar lógica de mapeo frágil.
// ---------------------------------------------------------------------------
const TIPO_CONSULTA = ["primera_vez", "subsecuente"] as const;
const tipoConsultaEnum = z.enum(TIPO_CONSULTA);

// ---------------------------------------------------------------------------
// Schemas de input
//   destino / antecedentes / diagnósticos CIE-11 provienen de @his/contracts (CC-0001).
//   tipoConsulta se mantiene local (§7 sin cambios respecto al CHECK de BD).
// ---------------------------------------------------------------------------

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
  /**
   * CC-0011 — opcional: el mockup avante2 elimina el campo de la UI. Si se
   * omite, el server lo deriva (ver `create`): 'subsecuente' si el paciente
   * ya tiene una HC previa no anulada, sino 'primera_vez'.
   */
  tipoConsulta: tipoConsultaEnum.optional(),
  motivoConsulta: z.string().min(1).max(2000).optional(),
  enfermedadActual: z.string().max(4000).optional(),
  /** RF-06 — Destino (catálogo cerrado de 8). Se persiste en columna disposicion. */
  destino: destinoEnum.optional(),
  /** RF-05 — análisis/correlación clínica. */
  analisisClinico: z.string().max(5000).optional(),
  planManejo: z.string().max(5000).optional(),
  antecedentes: antecedentesSchema.optional(),
  examenFisico: examenFisicoSchema,
  /** RF-03 — diagnósticos CIE-11 validados en borde de aplicación. */
  diagnosticos: z.array(cie11DiagnosticoSchema).optional(),
  // CC-0007 — campos estructurados nuevos (jsonb)
  antecedentesEstructurados: antecedentesEstructuradosSchema.optional(),
  planItems: z.array(planItemSchema).optional(),
  procedimientosCpt: z.array(procedimientoCptSchema).optional(),
  terapiaRespiratoria: terapiaRespiratoriaSchema.optional(),
  ordenesExamenes: z.array(ordenExamenSchema).optional(),
  ordenesInyecciones: z.array(ordenInyeccionSchema).optional(),
  /** CC-0011 — RF-01.3: nombre de pila (paciente LGBTIQ+). Actualiza Patient.preferredName. */
  nombrePila: z.string().trim().min(1).max(120).optional(),
  /** CC-0011 — RF-01.3: actualiza Patient.esLgbtiq. */
  esLgbtiq: z.boolean().optional(),
});

const updateInput = z.object({
  id: z.string().uuid(),
  tipoConsulta: tipoConsultaEnum.optional(),
  motivoConsulta: z.string().min(1).max(2000).optional(),
  enfermedadActual: z.string().max(4000).optional(),
  /** RF-06 — Destino (catálogo cerrado de 8). Se persiste en columna disposicion. */
  destino: destinoEnum.optional(),
  /** RF-05 — análisis/correlación clínica. */
  analisisClinico: z.string().max(5000).optional(),
  planManejo: z.string().max(5000).optional(),
  antecedentes: antecedentesSchema.optional(),
  examenFisico: examenFisicoSchema,
  /** RF-03 — diagnósticos CIE-11 validados en borde de aplicación. */
  diagnosticos: z.array(cie11DiagnosticoSchema).optional(),
  // CC-0007 — campos estructurados nuevos (jsonb)
  antecedentesEstructurados: antecedentesEstructuradosSchema.optional(),
  planItems: z.array(planItemSchema).optional(),
  procedimientosCpt: z.array(procedimientoCptSchema).optional(),
  terapiaRespiratoria: terapiaRespiratoriaSchema.optional(),
  ordenesExamenes: z.array(ordenExamenSchema).optional(),
  ordenesInyecciones: z.array(ordenInyeccionSchema).optional(),
});

const transitionInput = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid().optional(),
  observacion: z.string().max(1000).optional(),
});

/**
 * CC-0011 (item g) — contrato real de `firmar`. El anterior exigía `firmaId`
 * (un id de `ece.firma_electronica` que la UI nunca podía obtener de antemano)
 * y por eso la UI mandaba el PIN embebido en `observacion` como workaround
 * ("pin:1234"). Se reemplaza por el patrón usado en documentos ECE funcionales
 * (hoja-ingreso, solicitud-estudio): la UI manda el PIN en claro sobre TLS y
 * el server resuelve+valida el firmaId contra ece.firma_electronica (argon2id).
 */
const pinSchema = z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos");
const firmarInput = z.object({
  id: z.string().uuid(),
  pin: pinSchema,
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
  analisis_clinico: string | null;
  plan_manejo: string | null;
  antecedentes: unknown;
  examen_fisico: unknown;
  diagnosticos: unknown;
  antecedentes_estructurados: unknown;
  plan_items: unknown;
  procedimientos_cpt: unknown;
  terapia_respiratoria: unknown;
  ordenes_examenes: unknown;
  ordenes_inyecciones: unknown;
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
  /** RF-06 — Destino (se lee desde la columna disposicion). */
  destino: z.string().nullable(),
  /** RF-05 — análisis clínico. */
  analisisClinico: z.string().nullable(),
  planManejo: z.string().nullable(),
  antecedentes: z.unknown().nullable(),
  examenFisico: z.unknown().nullable(),
  diagnosticos: z.array(cie11DiagnosticoSchema),
  // CC-0007
  antecedentesEstructurados: antecedentesEstructuradosSchema.nullable(),
  planItems: z.array(planItemSchema).nullable(),
  procedimientosCpt: z.array(procedimientoCptSchema).nullable(),
  terapiaRespiratoria: terapiaRespiratoriaSchema.nullable(),
  ordenesExamenes: z.array(ordenExamenSchema).nullable(),
  ordenesInyecciones: z.array(ordenInyeccionSchema).nullable(),
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

/**
 * Parsea el JSONB de diagnosticos a array tipado CIE-11; degrada a [].
 * Acepta claves español (codigo/descripcion) y legacy inglés (code/description).
 * Legacy tipo principal/secundario → DEFINITIVO (no rompe lecturas históricas).
 */
function parseDiagnosticos(raw: unknown): Cie11Diagnostico[] {
  if (!raw) return [];
  try {
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);
    const parsed = JSON.parse(str) as unknown[];
    if (!Array.isArray(parsed)) return [];
    const result: Cie11Diagnostico[] = [];
    for (const item of parsed) {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const codigo = String(obj.codigo ?? obj.code ?? "").toUpperCase();
        const descripcion = String(obj.descripcion ?? obj.description ?? "");
        const tipoRaw = String(obj.tipo ?? "").toUpperCase();
        const tipo: Cie11Diagnostico["tipo"] =
          tipoRaw === "PRESUNTIVO" || tipoRaw === "COMPLEMENTARIO"
            ? (tipoRaw as Cie11Diagnostico["tipo"])
            : "DEFINITIVO";
        // CC-0011 (item a) — complemento (CC-0007 RF-08) se descartaba al leer;
        // el round-trip create→get→update perdía el texto libre por diagnóstico.
        const complemento =
          typeof obj.complemento === "string" && obj.complemento.length > 0
            ? obj.complemento
            : undefined;
        if (codigo && descripcion) {
          result.push({ codigo, descripcion, tipo, ...(complemento !== undefined && { complemento }) });
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers — firma electrónica (PIN → firmaId) + personal_salud
//
// Espejan el patrón de packages/trpc/src/routers/ece/solicitud-estudio.router.ts
// y hoja-ingreso.router.ts (documentos ECE ya funcionales con PIN argon2id).
// Se duplican localmente por la misma razón que el resto del bloque ECE:
// evitar import cruzado entre routers hermanos (ver cabecera de esos archivos).
//
// NOTA (hallazgo colateral): `registrado_por`/`ejecutado_por` en las tablas
// ECE referencian ece.personal_salud(id) — NO public."User".id. `buildEceCtx`
// devuelve `personalId: ctx.user.id` (usado solo para el GUC de RLS
// app.ece_personal_id, que ya se usaba así antes de este cambio). Para las
// columnas FK reales usamos `findPersonal()` abajo, que resuelve el id
// correcto de ece.personal_salud. `create()` insertaba antes ctx.user.id
// directo en `registrado_por` (bug preexistente — violación de FK real contra
// Postgres); se corrige aquí porque ya se toca esta función para RF de
// CC-0011 y la materialización nueva depende de resolver personal_salud.id
// correctamente. `validar()` no se tocó (fuera de alcance de este CC).
// ---------------------------------------------------------------------------

type RawTx = {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  labTest: {
    findFirst: (args: {
      where: { name: string; panel: { name: string } };
      select: { panel: { select: { area: true } } };
    }) => Promise<{ panel: { area: string } | null } | null>;
  };
};

interface PersonalRow {
  id: string;
}

interface FirmaRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
}

async function findPersonal(tx: RawTx, hisUserId: string): Promise<PersonalRow | null> {
  const rows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
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
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<FirmaRow[]>)`
    SELECT id::text, pin_hash, failed_attempts, locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

const LOCKOUT_MAX = 5;

/** Resuelve el personal_salud del firmante + valida el PIN contra argon2id. Retorna {firmaId, personalId}. */
async function verifyPinOrThrow(
  tx: RawTx,
  hisUserId: string,
  pin: string,
): Promise<{ firmaId: string; personalId: string }> {
  const personal = await findPersonal(tx, hisUserId);
  if (!personal) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se encontró un profesional de salud asociado a su cuenta.",
    });
  }
  const firma = await findFirma(tx, personal.id);
  if (!firma) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Firma electrónica no configurada. Use firma.setup para crearla.",
    });
  }
  if (firma.locked_until !== null && firma.locked_until > new Date()) {
    const mins = Math.ceil((firma.locked_until.getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada. Inténtelo en ${mins} min.`,
    });
  }
  const valid = await argon2.verify(firma.pin_hash, pin);
  if (!valid) {
    await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
      UPDATE ece.firma_electronica
      SET failed_attempts = failed_attempts + 1
      WHERE id = ${firma.id}::uuid
    `;
    const remaining = LOCKOUT_MAX - (firma.failed_attempts + 1);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        remaining > 0
          ? `PIN incorrecto. Intentos restantes: ${remaining}.`
          : "PIN incorrecto. La firma quedará bloqueada.",
    });
  }
  await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
    UPDATE ece.firma_electronica SET failed_attempts = 0 WHERE id = ${firma.id}::uuid
  `;
  return { firmaId: firma.id, personalId: personal.id };
}

// ---------------------------------------------------------------------------
// Helper — materializa ece.solicitud_estudio al firmar (item c, CC-0011)
//
// Agrupa ordenesExamenes por área resuelta desde el catálogo LIS
// (public."LabPanel"/"LabTest" — 185_cc0011_lab_catalogo_parametrizable.sql)
// y crea UNA solicitud_estudio por tipo (laboratorio/imagenologia/gabinete),
// espejando el patrón de ece/solicitud-estudio.router.ts `create`.
//
// Idempotencia: esta función solo se invoca desde `firmar` DESPUÉS de que el
// guard `cur.estado_registro !== 'borrador'` (ver arriba) impide re-ejecutar
// la transición borrador→firmado. Un segundo intento de `firmar` sobre la
// misma HC ya firmada falla con CONFLICT antes de llegar aquí — no se
// requiere columna de guard adicional en solicitud_estudio.
// ---------------------------------------------------------------------------

/** area del catálogo LIS → tipo aceptado por el CHECK de ece.solicitud_estudio. */
const AREA_TO_TIPO_ESTUDIO: Record<string, "laboratorio" | "imagenologia" | "gabinete"> = {
  LABORATORIO: "laboratorio",
  RADIOLOGIA: "imagenologia",
  CARDIOLOGIA: "gabinete",
};

async function materializarSolicitudesEstudio(
  tx: RawTx,
  opts: { episodioId: string; medicoSolicitanteId: string; ordenesExamenes: OrdenExamen[] },
): Promise<void> {
  if (opts.ordenesExamenes.length === 0) return;

  // Agrupar por tipo resuelto vía catálogo (seccion=panel.name, examen=test.name).
  // Fallback 'laboratorio' si el examen no matchea ningún panel/test del catálogo
  // (no bloquea la firma de la HC por un catálogo incompleto — RF-10 es best-effort).
  const grupos = new Map<"laboratorio" | "imagenologia" | "gabinete", string[]>();
  for (const item of opts.ordenesExamenes) {
    const match = await tx.labTest.findFirst({
      where: { name: item.examen, panel: { name: item.seccion } },
      select: { panel: { select: { area: true } } },
    });
    const area = match?.panel?.area ?? "LABORATORIO";
    const tipo = AREA_TO_TIPO_ESTUDIO[area] ?? "laboratorio";
    const list = grupos.get(tipo) ?? [];
    list.push(item.examen);
    grupos.set(tipo, list);
  }

  const tipoDocRows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
    SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
    FROM ece.tipo_documento td
    JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
    WHERE td.codigo = 'SOL_EST'
    LIMIT 1
  `;
  if (tipoDocRows.length === 0) return; // catálogo SOL_EST no configurado — no bloquea la firma de HC.
  const { tipo_doc_id, estado_inicial_id } = tipoDocRows[0]!;

  const episodioRows = await (tx.$queryRaw as (
    q: TemplateStringsArray,
    ...v: unknown[]
  ) => Promise<Array<{ paciente_id: string }>>)`
    SELECT paciente_id::text FROM ece.episodio_atencion WHERE id = ${opts.episodioId}::uuid LIMIT 1
  `;
  const pacienteId = episodioRows[0]?.paciente_id;
  if (!pacienteId) return; // episodio sin paciente vinculado — no debería ocurrir; no bloquea la firma.

  for (const [tipo, examenes] of grupos) {
    const instanciaRows = await (tx.$queryRaw as (
      q: TemplateStringsArray,
      ...v: unknown[]
    ) => Promise<Array<{ id: string }>>)`
      INSERT INTO ece.documento_instancia
        (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
      VALUES (
        ${tipo_doc_id}::uuid, ${opts.episodioId}::uuid, ${pacienteId}::uuid,
        ${estado_inicial_id}::uuid, ${opts.medicoSolicitanteId}::uuid
      )
      RETURNING id::text
    `;
    const instanciaId = instanciaRows[0]!.id;
    const examenesJson = JSON.stringify({ examenes, prioridad: "rutina" });
    await (tx.$executeRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>)`
      INSERT INTO ece.solicitud_estudio
        (instancia_id, episodio_id, tipo, examenes, medico_solicitante_id)
      VALUES (
        ${instanciaId}::uuid, ${opts.episodioId}::uuid, ${tipo},
        ${examenesJson}::jsonb, ${opts.medicoSolicitanteId}::uuid
      )
    `;
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
        analisis_clinico: string | null;
        plan_manejo: string | null;
        antecedentes: unknown;
        examen_fisico: unknown;
        diagnosticos: unknown;
        antecedentes_estructurados: unknown;
        plan_items: unknown;
        procedimientos_cpt: unknown;
        terapia_respiratoria: unknown;
        ordenes_examenes: unknown;
        ordenes_inyecciones: unknown;
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
            hc.analisis_clinico,
            hc.plan_manejo,
            hc.antecedentes,
            hc.examen_fisico,
            hc.diagnosticos,
            hc.antecedentes_estructurados,
            hc.plan_items,
            hc.procedimientos_cpt,
            hc.terapia_respiratoria,
            hc.ordenes_examenes,
            hc.ordenes_inyecciones,
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
        destino: raw.disposicion,
        analisisClinico: raw.analisis_clinico,
        planManejo: raw.plan_manejo,
        antecedentes: raw.antecedentes ?? null,
        examenFisico: raw.examen_fisico ?? null,
        diagnosticos: parseDiagnosticos(raw.diagnosticos),
        antecedentesEstructurados: raw.antecedentes_estructurados
          ? antecedentesEstructuradosSchema.nullable().parse(raw.antecedentes_estructurados)
          : null,
        planItems: raw.plan_items
          ? z.array(planItemSchema).nullable().parse(raw.plan_items)
          : null,
        procedimientosCpt: raw.procedimientos_cpt
          ? z.array(procedimientoCptSchema).nullable().parse(raw.procedimientos_cpt)
          : null,
        terapiaRespiratoria: raw.terapia_respiratoria
          ? terapiaRespiratoriaSchema.nullable().parse(raw.terapia_respiratoria)
          : null,
        ordenesExamenes: raw.ordenes_examenes
          ? z.array(ordenExamenSchema).nullable().parse(raw.ordenes_examenes)
          : null,
        ordenesInyecciones: raw.ordenes_inyecciones
          ? z.array(ordenInyeccionSchema).nullable().parse(raw.ordenes_inyecciones)
          : null,
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
   * RF-03: diagnosticos validados por cie11DiagnosticoSchema antes del INSERT.
   */
  create: writeBase.input(createInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      // CC-0011 (item d) — GUCs de tenant además de los de ECE, en la MISMA tx:
      // necesarios para el UPDATE a public."Patient" (RLS de esa tabla lee
      // app.current_org_id, no app.ece_*). SET LOCAL acumula GUCs distintos
      // sin pisar los que ya seteó withEceContext.
      await applyTenantContext(tx, ctx.tenant);

      // CC-0011 — resuelve el personal_salud del autor. `registrado_por` referencia
      // ece.personal_salud(id), no public."User".id (ver nota junto a findPersonal).
      const personal = await findPersonal(tx as unknown as RawTx, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se encontró un profesional de salud asociado a su cuenta.",
        });
      }

      // Resuelve paciente_id (ece) + public_patient_id (public."Patient") del episodio.
      const episodioRows = await tx.$queryRaw<{ paciente_id: string; public_patient_id: string | null }[]>`
        SELECT ea.paciente_id::text AS paciente_id, ep.public_patient_id::text AS public_patient_id
        FROM ece.episodio_atencion ea
        JOIN ece.paciente ep ON ep.id = ea.paciente_id
        WHERE ea.id = ${input.episodioId}::uuid
        LIMIT 1
      `;
      const episodio = episodioRows[0];
      if (!episodio) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Episodio no encontrado." });
      }

      // RF — tipoConsulta: si no viene del cliente (mockup avante2 elimina el
      // campo), 'subsecuente' si el paciente ya tiene una HC previa no
      // anulada; sino 'primera_vez'.
      let tipoConsulta = input.tipoConsulta;
      if (!tipoConsulta) {
        const previaRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT hc.id::text
          FROM ece.historia_clinica hc
          JOIN ece.episodio_atencion ea ON ea.id = hc.episodio_id
          WHERE ea.paciente_id = ${episodio.paciente_id}::uuid
            AND hc.estado_registro != 'anulado'
          LIMIT 1
        `;
        tipoConsulta = previaRows.length > 0 ? "subsecuente" : "primera_vez";
      }

      // CC-0011 (item d) — RF-01.3: nombre de pila / LGBTIQ+ del paciente.
      if ((input.nombrePila !== undefined || input.esLgbtiq !== undefined) && episodio.public_patient_id) {
        await tx.patient.update({
          where: { id: episodio.public_patient_id },
          data: {
            ...(input.nombrePila !== undefined && { preferredName: input.nombrePila }),
            ...(input.esLgbtiq !== undefined && { esLgbtiq: input.esLgbtiq }),
          },
        });
      }

      const diagnosticosJson = input.diagnosticos ? JSON.stringify(input.diagnosticos) : null;
      const antecedentesJson = input.antecedentes ? JSON.stringify(input.antecedentes) : null;
      const examenFisicoJson = input.examenFisico ? JSON.stringify(input.examenFisico) : null;
      const antecedentesEstructuradosJson = input.antecedentesEstructurados ? JSON.stringify(input.antecedentesEstructurados) : null;
      const planItemsJson = input.planItems ? JSON.stringify(input.planItems) : null;
      const procedimientosCptJson = input.procedimientosCpt ? JSON.stringify(input.procedimientosCpt) : null;
      const terapiaRespiratoriaJson = input.terapiaRespiratoria ? JSON.stringify(input.terapiaRespiratoria) : null;
      const ordenesExamenesJson = input.ordenesExamenes ? JSON.stringify(input.ordenesExamenes) : null;
      const ordenesInyeccionesJson = input.ordenesInyecciones ? JSON.stringify(input.ordenesInyecciones) : null;

      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          INSERT INTO ece.historia_clinica
            (instancia_id, episodio_id, tipo_consulta, motivo_consulta,
             enfermedad_actual, disposicion, analisis_clinico, plan_manejo,
             antecedentes, examen_fisico, diagnosticos,
             antecedentes_estructurados, plan_items, procedimientos_cpt,
             terapia_respiratoria, ordenes_examenes, ordenes_inyecciones,
             registrado_por, estado_registro)
          VALUES (
            ${input.instanciaId ?? null}::uuid,
            ${input.episodioId}::uuid,
            ${tipoConsulta}::text,
            ${input.motivoConsulta ?? null},
            ${input.enfermedadActual ?? null},
            ${input.destino ?? null},
            ${input.analisisClinico ?? null},
            ${input.planManejo ?? null},
            ${antecedentesJson ?? null}::jsonb,
            ${examenFisicoJson ?? null}::jsonb,
            ${diagnosticosJson ?? null}::jsonb,
            ${antecedentesEstructuradosJson ?? null}::jsonb,
            ${planItemsJson ?? null}::jsonb,
            ${procedimientosCptJson ?? null}::jsonb,
            ${terapiaRespiratoriaJson ?? null}::jsonb,
            ${ordenesExamenesJson ?? null}::jsonb,
            ${ordenesInyeccionesJson ?? null}::jsonb,
            ${personal.id}::uuid,
            'borrador'
          )
          RETURNING
            id::text, instancia_id::text, episodio_id::text,
            tipo_consulta, motivo_consulta, enfermedad_actual,
            disposicion, analisis_clinico, plan_manejo,
            antecedentes, examen_fisico, diagnosticos,
            antecedentes_estructurados, plan_items, procedimientos_cpt,
            terapia_respiratoria, ordenes_examenes, ordenes_inyecciones,
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
      if (input.destino !== undefined)
        sets.push(Prisma.sql`disposicion = ${input.destino}`);
      if (input.analisisClinico !== undefined)
        sets.push(Prisma.sql`analisis_clinico = ${input.analisisClinico}`);
      if (input.planManejo !== undefined)
        sets.push(Prisma.sql`plan_manejo = ${input.planManejo}`);
      if (input.antecedentes !== undefined)
        sets.push(Prisma.sql`antecedentes = ${JSON.stringify(input.antecedentes)}::jsonb`);
      if (input.examenFisico !== undefined)
        sets.push(Prisma.sql`examen_fisico = ${JSON.stringify(input.examenFisico)}::jsonb`);
      if (input.diagnosticos !== undefined)
        sets.push(Prisma.sql`diagnosticos = ${JSON.stringify(input.diagnosticos)}::jsonb`);
      if (input.antecedentesEstructurados !== undefined)
        sets.push(Prisma.sql`antecedentes_estructurados = ${JSON.stringify(input.antecedentesEstructurados)}::jsonb`);
      if (input.planItems !== undefined)
        sets.push(Prisma.sql`plan_items = ${JSON.stringify(input.planItems)}::jsonb`);
      if (input.procedimientosCpt !== undefined)
        sets.push(Prisma.sql`procedimientos_cpt = ${JSON.stringify(input.procedimientosCpt)}::jsonb`);
      if (input.terapiaRespiratoria !== undefined)
        sets.push(Prisma.sql`terapia_respiratoria = ${JSON.stringify(input.terapiaRespiratoria)}::jsonb`);
      if (input.ordenesExamenes !== undefined)
        sets.push(Prisma.sql`ordenes_examenes = ${JSON.stringify(input.ordenesExamenes)}::jsonb`);
      if (input.ordenesInyecciones !== undefined)
        sets.push(Prisma.sql`ordenes_inyecciones = ${JSON.stringify(input.ordenesInyecciones)}::jsonb`);

      if (sets.length === 0) {
        const noop = await tx.$queryRaw<HistoriaClinicaRow[]>(
          Prisma.sql`
            SELECT id::text, instancia_id::text, episodio_id::text,
              tipo_consulta, motivo_consulta, enfermedad_actual,
              disposicion, analisis_clinico, plan_manejo,
              antecedentes, examen_fisico, diagnosticos,
              antecedentes_estructurados, plan_items, procedimientos_cpt,
              terapia_respiratoria, ordenes_examenes, ordenes_inyecciones,
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
            disposicion, analisis_clinico, plan_manejo,
            antecedentes, examen_fisico, diagnosticos,
            antecedentes_estructurados, plan_items, procedimientos_cpt,
            terapia_respiratoria, ordenes_examenes, ordenes_inyecciones,
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
  firmar: firmaBase.input(firmarInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withEceContext(ctx.prisma, eceCtx.personalId, eceCtx.establecimientoId, async (tx) => {
      // CC-0011 (item g/c) — GUCs de tenant en la MISMA tx: necesarios para que
      // la resolución de área del catálogo LIS (public."LabPanel"/"LabTest")
      // vea también paneles propios del tenant, no solo los globales.
      await applyTenantContext(tx, ctx.tenant);

      type FirmarFetchRow = {
        estado_registro: string;
        instancia_id: string | null;
        episodio_id: string;
        motivo_consulta: string | null;
        enfermedad_actual: string | null;
        plan_manejo: string | null;
        diagnosticos: unknown;
        ordenes_examenes: unknown;
      };

      const current = await tx.$queryRaw<FirmarFetchRow[]>(
        Prisma.sql`
          SELECT estado_registro, instancia_id::text, episodio_id::text,
                 motivo_consulta, enfermedad_actual, plan_manejo, diagnosticos, ordenes_examenes
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

      // RN-03 (CC-0001) — al firmar debe existir ≥1 diagnóstico Complementario.
      if (!tieneComplementario(parseDiagnosticos(cur.diagnosticos))) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "RN-03: se requiere al menos un diagnóstico de tipo Complementario antes de firmar.",
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

      // CC-0011 (item g) — valida el PIN y resuelve firmaId + personal_salud.id
      // reales (reemplaza el firmaId que la UI nunca podía obtener de antemano).
      const { firmaId, personalId } = await verifyPinOrThrow(tx as unknown as RawTx, ctx.user.id, input.pin);

      const rows = await tx.$queryRaw<HistoriaClinicaRow[]>(
        Prisma.sql`
          UPDATE ece.historia_clinica
          SET estado_registro = 'firmado'
          WHERE id = ${input.id}::uuid
          RETURNING
            id::text, instancia_id::text, episodio_id::text,
            tipo_consulta, motivo_consulta, enfermedad_actual,
            disposicion, analisis_clinico, plan_manejo,
            antecedentes, examen_fisico, diagnosticos,
            antecedentes_estructurados, plan_items, procedimientos_cpt,
            terapia_respiratoria, ordenes_examenes, ordenes_inyecciones,
            registrado_por::text, registrado_en, estado_registro
        `,
      );

      const updated = assertFound(rows[0], "HistoriaClinica firmada");

      // JCI IPSG.2 ME 3 — adjuntar warnings a response (no bloquea)
      const ipsg2Warnings = [...ipsg2.errors, ...ipsg2.warnings];

      // Registrar en historial de instancia si existe vínculo workflow.
      // NOTA (hallazgo colateral, no corregido): este INSERT usa el shape legacy
      // del router (accion/ejecutado_por/firma_id/observacion/payload_hash) que
      // no coincide con la tabla real de 60_ece_05_motor.sql (falta
      // estado_nuevo_id/rol_ejecutor_id NOT NULL; payload_hash no existe como
      // columna — ver 123_who_checklist_enforce.sql comentario "Modelo real
      // verificado vía MCP"). Hoy es inerte porque nada en `create()` vincula
      // historia_clinica a un documento_instancia real (instancia_id siempre
      // null salvo que el cliente lo mande explícito). Si un futuro CC conecta
      // HIST_CLIN al motor workflow-designer, reescribir con el patrón
      // `avanzarEstado` de hoja-ingreso.router.ts/solicitud-estudio.router.ts.
      if (cur.instancia_id) {
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO ece.documento_instancia_historial
              (instancia_id, accion, ejecutado_por, firma_id, observacion, payload_hash)
            VALUES (
              ${cur.instancia_id}::uuid,
              'firmar',
              ${personalId}::uuid,
              ${firmaId}::uuid,
              ${input.observacion ?? null},
              encode(digest(${input.id}, 'sha256'), 'hex')
            )
          `,
        );
      }

      // CC-0011 (item c) — materializa ece.solicitud_estudio por cada tipo
      // (laboratorio/imagenologia/gabinete) presente en ordenesExamenes.
      // Idempotente porque el guard de estado (arriba) impide re-firmar.
      let ordenesExamenesParsed: OrdenExamen[] = [];
      if (cur.ordenes_examenes) {
        const safeParsed = z.array(ordenExamenSchema).safeParse(cur.ordenes_examenes);
        if (safeParsed.success) ordenesExamenesParsed = safeParsed.data;
      }
      await materializarSolicitudesEstudio(tx as unknown as RawTx, {
        episodioId: cur.episodio_id,
        medicoSolicitanteId: personalId,
        ordenesExamenes: ordenesExamenesParsed,
      });

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
            disposicion, analisis_clinico, plan_manejo,
            antecedentes, examen_fisico, diagnosticos,
            antecedentes_estructurados, plan_items, procedimientos_cpt,
            terapia_respiratoria, ordenes_examenes, ordenes_inyecciones,
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
