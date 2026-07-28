/**
 * Router tRPC — ECE Signos Vitales (SIG_VIT).
 *
 * Documento NTEC: SIG_VIT — Toma y Registro de Signos Vitales.
 * Norma: MINSAL Acuerdo n.° 1616 (2024) — documento clínico de enfermería
 *   de alta frecuencia (múltiples tomas por turno durante hospitalización).
 * Código de tipo_documento: SIG_VIT.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (código tipo: SIG_VIT)
 * ---------------------------------------------------------------------------
 *   borrador    → en_revision  (NURSE: completar toma)
 *   en_revision → firmado      (NURSE: firma — inmutable post-firma)
 *   firmado     → validado     (NURSE: validación por supervisora)
 *   cualquiera  → anulado      (NURSE/PHYSICIAN: corrección de toma errónea)
 *
 *   Al firmar, si no existe ece.documento_instancia para la toma, se crea
 *   automáticamente. La inmutabilidad se logra rechazando UPDATE en el router
 *   (no hay trigger dedicado — la lógica vive en JS).
 *
 *   Cada transición inserta fila en ece.documento_instancia_historial con
 *   hash SHA-256 del payload JSON (cadena de auditoría, análogo a §6.3 TDR).
 *
 * ---------------------------------------------------------------------------
 * OUTBOX
 * ---------------------------------------------------------------------------
 *   No emite eventos de dominio propios. Los signos vitales son consumidos
 *   directamente por la UI de enfermería; el event outbox no es necesario
 *   para el flujo de alta frecuencia (trade-off: latencia vs. consistencia).
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.signos_vitales                — fila principal: episodio_id (nullable desde
 *                                       CC-0012), cuenta_id, paciente_id, fecha_hora_toma,
 *                                       presion_sistolica, presion_diastolica,
 *                                       frecuencia_cardiaca, frecuencia_respiratoria,
 *                                       saturacion_o2, escala_dolor,
 *                                       peso_kg, talla_cm, imc, glucometria_mgdl,
 *                                       peso_lb, talla_ft (CC-0012),
 *                                       go_gestas/go_partos_termino/go_partos_pretermino/
 *                                       go_abortos/go_vivos, fpp_activo (CC-0012)
 *   ece.documento_instancia           — instancia de workflow del documento
 *   ece.documento_instancia_historial — log de transiciones + SHA-256 payload
 *   ece.tipo_documento                — resolución de tipoDocumentoId por código 'SIG_VIT'
 *   ece.flujo_estado                  — estado inicial configurado para SIG_VIT
 *
 * CC-0012 — módulo transversal: la toma se ancla al episodio y/o a la cuenta
 * activa del paciente (public."PatientAccount"). `create` resuelve el ancla
 * faltante server-side (mismo algoritmo que patient.router.ts#contextoCuenta):
 *   - cuentaId sin episodioId → resuelve episodio abierto/en_curso (por
 *     encounterId de la cuenta, fallback último abierto del paciente).
 *   - episodioId sin cuentaId → resuelve la cuenta activa del paciente (por
 *     encounterId del episodio, fallback más reciente createdAt) y la persiste.
 * La resolución que toca `public."PatientAccount"` corre en transacciones
 * `withTenantContext` separadas (RLS de esa tabla exige GUC `app.current_org_id`,
 * distinto del contexto `ece.*` que setea `withEceContext`).
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list, get      → requireRole(["NURSE","PHYSICIAN"])
 *   create, update → requireRole(["NURSE","PHYSICIAN","MC","MT"])  (CC-0001 RF-04)
 *   firmar         → requireRole(["NURSE"])
 *   validar        → requireRole(["NURSE"])
 *   anular         → requireRole(["NURSE","PHYSICIAN"])
 *
 * @QA E2E a cubrir:
 *   - Flujo completo create → firmar → validar con credenciales NURSE.
 *   - Intentar update de registro firmado → 400 PRECONDITION_FAILED.
 *   - PHYSICIAN intenta firmar → 403 FORBIDDEN.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import { withTenantContext } from "../../rls-context";
import {
  eceSignosVitalesCreateSchema,
  eceSignosVitalesUpdateSchema,
  type EceSignosVitalesUpdateInput,
} from "@his/contracts";

// ─── Tipos de fila raw ───────────────────────────────────────────────────────

export interface SignosVitalesRow {
  id: string;
  episodio_id: string | null;
  cuenta_id: string | null;
  paciente_id: string | null;
  instancia_id: string | null;
  registrado_por: string;
  presion_sistolica: number | null;
  presion_diastolica: number | null;
  frecuencia_cardiaca: number | null;
  frecuencia_respiratoria: number | null;
  temperatura: number | null;
  saturacion_o2: number | null;
  escala_dolor: number | null;
  peso_kg: number | null;
  talla_cm: number | null;
  imc: number | null;
  glucometria_mgdl: number | null;
  observaciones: string | null;
  fecha_hora_toma: Date;
  estado_registro: string;
  registrado_en: Date;
  // CC-0007 — campos nuevos (migración 182)
  glasgow_ocular: number | null;
  glasgow_verbal: number | null;
  glasgow_motor: number | null;
  glasgow_total: number | null;
  fio2: number | null;
  perimetro_cintura: number | null;
  ict: number | null;
  balance_hidrico: number | null;
  diuresis: number | null;
  fur: string | null;
  fpp: string | null;
  // CC-0012 — módulo transversal (migración 188)
  peso_lb: number | null;
  talla_ft: number | null;
  fpp_activo: boolean | null;
  go_gestas: number | null;
  go_partos_termino: number | null;
  go_partos_pretermino: number | null;
  go_abortos: number | null;
  go_vivos: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Genera SHA-256 de un objeto JSON determinístico. */
function hashPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

/**
 * Calcula IMC si peso y talla están disponibles.
 * Retorna null si alguno falta o talla es cero.
 */
function calcularImc(pesoKg: number | null | undefined, tallaCm: number | null | undefined): number | null {
  if (!pesoKg || !tallaCm || tallaCm === 0) return null;
  const tallaM = tallaCm / 100;
  return Math.round((pesoKg / (tallaM * tallaM)) * 10) / 10;
}

/**
 * Calcula Glasgow Total si los 3 componentes están presentes.
 * El cliente puede enviar glasgowTotal explícito; esta función lo deriva
 * desde los componentes — la app es fuente de verdad.
 */
function calcularGlasgowTotal(
  ocular: number | null | undefined,
  verbal: number | null | undefined,
  motor: number | null | undefined,
): number | null {
  if (ocular == null || verbal == null || motor == null) return null;
  return ocular + verbal + motor;
}

/**
 * Calcula ICT (índice cintura-talla) si ambos insumos están presentes.
 * Retorna null si alguno falta o talla es cero.
 */
function calcularIct(perimetroCintura: number | null | undefined, tallaCm: number | null | undefined): number | null {
  if (!perimetroCintura || !tallaCm || tallaCm === 0) return null;
  return Math.round((perimetroCintura / tallaCm) * 1000) / 1000;
}

// ─── CC-0012 — resolución de ancla transversal (episodio ↔ cuenta) ──────────

type EceTx = {
  $queryRaw: <T>(tpl: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
};

/**
 * Resuelve el episodio abierto/en_curso para una cuenta, mismo algoritmo que
 * `patient.router.ts#contextoCuenta`: Paso 1 — por `encounterId` de la cuenta
 * (si tiene); Paso 2 — fallback al episodio abierto más reciente del paciente.
 * Corre DENTRO de la transacción ece (withEceContext) — solo toca ece.*.
 */
async function resolveEpisodioAbiertoDesdeCuenta(
  tx: EceTx,
  encounterId: string | null,
  publicPatientId: string,
): Promise<string | null> {
  if (encounterId) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT ea.id::text AS id
      FROM ece.episodio_atencion ea
      WHERE ea.public_encounter_id = ${encounterId}::uuid
        AND ea.estado IN ('abierto', 'en_curso')
      ORDER BY ea.creado_en DESC
      LIMIT 1
    `;
    if (rows[0]) return rows[0].id;
  }

  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT ea.id::text AS id
    FROM ece.episodio_atencion ea
    JOIN ece.paciente ep ON ep.id = ea.paciente_id
    WHERE ep.public_patient_id = ${publicPatientId}::uuid
      AND ea.estado IN ('abierto', 'en_curso')
    ORDER BY ea.creado_en DESC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

interface EpisodioInfo {
  pacienteIdEce: string;
  publicPatientId: string | null;
  publicEncounterId: string | null;
}

/** Resuelve paciente (ece interno + ACL público) y encuentro público del episodio. */
async function resolveEpisodioInfo(tx: EceTx, episodioId: string): Promise<EpisodioInfo | null> {
  const rows = await tx.$queryRaw<
    { paciente_id_ece: string; public_patient_id: string | null; public_encounter_id: string | null }[]
  >`
    SELECT
      ea.paciente_id::text AS paciente_id_ece,
      ep.public_patient_id::text AS public_patient_id,
      ea.public_encounter_id::text AS public_encounter_id
    FROM ece.episodio_atencion ea
    JOIN ece.paciente ep ON ep.id = ea.paciente_id
    WHERE ea.id = ${episodioId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    pacienteIdEce: row.paciente_id_ece,
    publicPatientId: row.public_patient_id,
    publicEncounterId: row.public_encounter_id,
  };
}

/** Resuelve ece.paciente.id (interno) a partir del ACL público (public."Patient".id). */
async function resolvePacienteEceId(tx: EceTx, publicPatientId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM ece.paciente WHERE public_patient_id = ${publicPatientId}::uuid LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

interface PatientAccountLike {
  id: string;
  patientId: string;
  encounterId: string | null;
}

/**
 * Resuelve la cuenta de paciente (public."PatientAccount") dada por id, con
 * enforcement de tenant (organizationId). Corre en su PROPIA transacción
 * `withTenantContext` — RLS de PatientAccount exige el GUC `app.current_org_id`,
 * que `withEceContext` no setea.
 */
async function resolveCuentaPorId(
  prisma: Parameters<typeof withTenantContext>[0],
  tenant: Parameters<typeof withTenantContext>[1],
  cuentaId: string,
): Promise<PatientAccountLike | null> {
  return withTenantContext(prisma, tenant, async (tx) =>
    tx.patientAccount.findFirst({
      where: { id: cuentaId, organizationId: tenant.organizationId },
      select: { id: true, patientId: true, encounterId: true },
    }),
  );
}

/**
 * Resuelve la cuenta ACTIVA de un paciente: por `encounterId` (si coincide con
 * el del episodio) o, en su defecto, la más reciente por `createdAt` (CC-0012).
 * Misma transacción `withTenantContext` que `resolveCuentaPorId`.
 */
async function resolveCuentaActivaDePaciente(
  prisma: Parameters<typeof withTenantContext>[0],
  tenant: Parameters<typeof withTenantContext>[1],
  publicPatientId: string,
  encounterId: string | null,
): Promise<PatientAccountLike | null> {
  return withTenantContext(prisma, tenant, async (tx) => {
    if (encounterId) {
      const byEncounter = await tx.patientAccount.findFirst({
        where: {
          patientId: publicPatientId,
          organizationId: tenant.organizationId,
          encounterId,
        },
        select: { id: true, patientId: true, encounterId: true },
      });
      if (byEncounter) return byEncounter;
    }

    return tx.patientAccount.findFirst({
      where: { patientId: publicPatientId, organizationId: tenant.organizationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, patientId: true, encounterId: true },
    });
  });
}

/**
 * Resuelve el UUID del tipo de documento SIG_VIT y del estado por código.
 * Ambas queries son idempotentes (catálogo inmutable en runtime).
 */
async function resolveDocMetadata(
  tx: { $queryRaw: <T>(tpl: TemplateStringsArray, ...values: unknown[]) => Promise<T> },
  estadoCodigo: string,
): Promise<{ tipoDocumentoId: string; estadoId: string }> {
  const tipoRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM ece.tipo_documento WHERE codigo = 'SIG_VIT' LIMIT 1
  `;
  if (!tipoRows[0]) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Tipo de documento SIG_VIT no está configurado en el catálogo.",
    });
  }

  const estadoRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT fe.id::text
    FROM ece.flujo_estado fe
    JOIN ece.tipo_documento td ON td.id = fe.tipo_documento_id
    WHERE td.codigo = 'SIG_VIT'
      AND fe.codigo = ${estadoCodigo}
    LIMIT 1
  `;
  if (!estadoRows[0]) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Estado ${estadoCodigo} no configurado para SIG_VIT.`,
    });
  }

  return {
    tipoDocumentoId: tipoRows[0].id,
    estadoId: estadoRows[0].id,
  };
}

/**
 * Obtiene o crea la instancia de documento_instancia para un registro de
 * signos vitales. Si no existe la crea en el estado dado.
 */
async function upsertDocInstancia(
  tx: {
    $queryRaw: <T>(tpl: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
    $executeRaw: (tpl: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  },
  opts: {
    signosVitalesId: string;
    episodioId: string | null | undefined;
    tipoDocumentoId: string;
    estadoId: string;
    personalId: string;
  },
): Promise<{ instanciaId: string; isNew: boolean }> {
  // Buscar instancia existente ligada al registro de signos vitales
  const existing = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text
    FROM ece.documento_instancia
    WHERE registro_id = ${opts.signosVitalesId}::uuid
    LIMIT 1
  `;

  if (existing[0]) {
    return { instanciaId: existing[0].id, isNew: false };
  }

  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO ece.documento_instancia
      (tipo_documento_id, episodio_id, registro_id, estado_actual_id, creado_por)
    VALUES (
      ${opts.tipoDocumentoId}::uuid,
      ${opts.episodioId ?? null}::uuid,
      ${opts.signosVitalesId}::uuid,
      ${opts.estadoId}::uuid,
      ${opts.personalId}::uuid
    )
    RETURNING id::text
  `;

  return { instanciaId: rows[0]!.id, isNew: true };
}

/**
 * Inserta fila en ece.documento_instancia_historial con hash del payload.
 */
async function insertHistorial(
  tx: { $executeRaw: (tpl: TemplateStringsArray, ...values: unknown[]) => Promise<number> },
  opts: {
    instanciaId: string;
    estadoAnteriorId: string | null;
    estadoNuevoId: string;
    accion: string;
    personalId: string;
    payload: unknown;
  },
): Promise<void> {
  const payloadJson = JSON.stringify(opts.payload);
  const payloadHash = hashPayload(opts.payload);

  await tx.$executeRaw`
    INSERT INTO ece.documento_instancia_historial
      (instancia_id, estado_anterior_id, estado_nuevo_id, accion,
       ejecutado_por, payload_hash, observacion)
    VALUES (
      ${opts.instanciaId}::uuid,
      ${opts.estadoAnteriorId}::uuid,
      ${opts.estadoNuevoId}::uuid,
      ${opts.accion},
      ${opts.personalId}::uuid,
      ${payloadHash},
      ${payloadJson}
    )
  `;
}

// ─── Base procedure ──────────────────────────────────────────────────────────

// CC-0001 RF-04 — lectura abierta a roles clínicos (incluye MC/MT) para que la
// tabla de tomas sea visible desde la pantalla de HC a quien también las registra.
const base = requireRole(["NURSE", "PHYSICIAN", "MC", "MT"]);
const nurseOnly = requireRole(["NURSE"]);
// CC-0001 RF-04 — el médico también registra tomas desde la pantalla de HC.
// La firma/validación de la toma sigue siendo gobernanza de enfermería (nurseOnly).
const tomaWrite = requireRole(["NURSE", "PHYSICIAN", "MC", "MT"]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const eceSignosVitalesRouter = router({
  /**
   * Lista tomas de signos vitales con filtros opcionales.
   * CC-0012 — requiere al menos episodioId o cuentaId (ambos filtran por AND
   * cuando se envían los dos).
   */
  list: base
    .input(
      z.object({
        episodioId: z.string().uuid().optional(),
        cuentaId: z.string().uuid().optional(),
        desde: z.string().datetime({ offset: true }).optional(),
        hasta: z.string().datetime({ offset: true }).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!input.episodioId && !input.cuentaId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere episodioId o cuentaId.",
        });
      }

      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<SignosVitalesRow[]>`
          SELECT
            sv.id::text,
            sv.episodio_id::text,
            sv.cuenta_id::text,
            sv.paciente_id::text,
            sv.instancia_id::text,
            sv.registrado_por::text,
            sv.presion_sistolica,
            sv.presion_diastolica,
            sv.frecuencia_cardiaca,
            sv.frecuencia_respiratoria,
            sv.temperatura,
            sv.saturacion_o2,
            sv.escala_dolor,
            sv.peso_kg,
            sv.talla_cm,
            sv.imc,
            sv.glucometria_mgdl,
            sv.observaciones,
            sv.fecha_hora_toma,
            sv.estado_registro,
            sv.registrado_en,
            sv.glasgow_ocular,
            sv.glasgow_verbal,
            sv.glasgow_motor,
            sv.glasgow_total,
            sv.fio2,
            sv.perimetro_cintura,
            sv.ict,
            sv.balance_hidrico,
            sv.diuresis,
            sv.fur::text,
            sv.fpp::text,
            sv.peso_lb,
            sv.talla_ft,
            sv.fpp_activo,
            sv.go_gestas,
            sv.go_partos_termino,
            sv.go_partos_pretermino,
            sv.go_abortos,
            sv.go_vivos
          FROM ece.signos_vitales sv
          WHERE (${input.episodioId ?? null}::uuid IS NULL OR sv.episodio_id = ${input.episodioId ?? null}::uuid)
            AND (${input.cuentaId ?? null}::uuid IS NULL OR sv.cuenta_id = ${input.cuentaId ?? null}::uuid)
            AND (${input.desde ?? null}::timestamptz IS NULL
              OR sv.fecha_hora_toma >= ${input.desde ?? null}::timestamptz)
            AND (${input.hasta ?? null}::timestamptz IS NULL
              OR sv.fecha_hora_toma <= ${input.hasta ?? null}::timestamptz)
            AND (${input.cursor ?? null}::uuid IS NULL
              OR sv.id > ${input.cursor ?? null}::uuid)
          ORDER BY sv.fecha_hora_toma DESC, sv.id DESC
          LIMIT ${input.limit + 1}
        `;

        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1]!.id : null;

        return { items, nextCursor };
      });
    }),

  /** Obtiene una toma por id. */
  get: base
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<SignosVitalesRow[]>`
          SELECT
            sv.id::text,
            sv.episodio_id::text,
            sv.cuenta_id::text,
            sv.paciente_id::text,
            sv.instancia_id::text,
            sv.registrado_por::text,
            sv.presion_sistolica,
            sv.presion_diastolica,
            sv.frecuencia_cardiaca,
            sv.frecuencia_respiratoria,
            sv.temperatura,
            sv.saturacion_o2,
            sv.escala_dolor,
            sv.peso_kg,
            sv.talla_cm,
            sv.imc,
            sv.glucometria_mgdl,
            sv.observaciones,
            sv.fecha_hora_toma,
            sv.estado_registro,
            sv.registrado_en,
            sv.glasgow_ocular,
            sv.glasgow_verbal,
            sv.glasgow_motor,
            sv.glasgow_total,
            sv.fio2,
            sv.perimetro_cintura,
            sv.ict,
            sv.balance_hidrico,
            sv.diuresis,
            sv.fur::text,
            sv.fpp::text,
            sv.peso_lb,
            sv.talla_ft,
            sv.fpp_activo,
            sv.go_gestas,
            sv.go_partos_termino,
            sv.go_partos_pretermino,
            sv.go_abortos,
            sv.go_vivos
          FROM ece.signos_vitales sv
          WHERE sv.id = ${input.id}::uuid
          LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Signos vitales no encontrados: ${input.id}`,
          });
        }

        return rows[0];
      });
    }),

  /**
   * Crea una nueva toma de signos vitales en estado "borrador".
   * Valida rangos plausibles vía Zod antes de llegar a la BD.
   * IMC/Glasgow total/ICT se calculan automáticamente si los insumos están
   * provistos. CC-0012 — resuelve el ancla faltante (episodio ↔ cuenta) y
   * persiste SIEMPRE paciente_id además de los campos G·P·P·A·V/pesoLb/
   * tallaFt/fppActivo.
   */
  create: tomaWrite
    .input(eceSignosVitalesCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      // Fase 1 — si viene cuentaId: resolver patientId/encounterId de la
      // cuenta (schema public, transacción withTenantContext propia).
      let cuentaPatientId: string | null = null;
      let cuentaEncounterId: string | null = null;
      if (input.cuentaId) {
        const account = await resolveCuentaPorId(ctx.prisma, ctx.tenant, input.cuentaId);
        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta de paciente no encontrada." });
        }
        cuentaPatientId = account.patientId;
        cuentaEncounterId = account.encounterId;
      }

      const imc = calcularImc(input.pesoKg, input.tallaCm);
      const glasgowTotal = calcularGlasgowTotal(input.glasgowOcular, input.glasgowVerbal, input.glasgowMotor);
      const ict = calcularIct(input.perimetroCintura, input.tallaCm);

      // Fase 2 — resolución de anclas dentro del contexto ece + INSERT.
      const resultado = await withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        let episodioId = input.episodioId ?? null;
        let publicPatientId = cuentaPatientId;
        let publicEncounterId = cuentaEncounterId;

        if (!episodioId && cuentaPatientId) {
          episodioId = await resolveEpisodioAbiertoDesdeCuenta(tx, cuentaEncounterId, cuentaPatientId);
        }

        let pacienteIdEce: string | null = null;
        if (publicPatientId) {
          pacienteIdEce = await resolvePacienteEceId(tx, publicPatientId);
        } else if (episodioId) {
          const info = await resolveEpisodioInfo(tx, episodioId);
          if (info) {
            pacienteIdEce = info.pacienteIdEce;
            publicPatientId = info.publicPatientId;
            publicEncounterId = info.publicEncounterId;
          }
        }

        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.signos_vitales (
            episodio_id, cuenta_id, paciente_id, registrado_por,
            presion_sistolica, presion_diastolica,
            frecuencia_cardiaca, frecuencia_respiratoria,
            temperatura, saturacion_o2, escala_dolor,
            peso_kg, talla_cm, imc, glucometria_mgdl, observaciones,
            fecha_hora_toma, estado_registro,
            glasgow_ocular, glasgow_verbal, glasgow_motor, glasgow_total,
            fio2, perimetro_cintura, ict, balance_hidrico, diuresis,
            fur, fpp, peso_lb, talla_ft, fpp_activo,
            go_gestas, go_partos_termino, go_partos_pretermino, go_abortos, go_vivos
          ) VALUES (
            ${episodioId}::uuid,
            ${input.cuentaId ?? null}::uuid,
            ${pacienteIdEce}::uuid,
            ${personalId}::uuid,
            ${input.presionSistolica ?? null},
            ${input.presionDiastolica ?? null},
            ${input.frecuenciaCardiaca ?? null},
            ${input.frecuenciaRespiratoria ?? null},
            ${input.temperatura ?? null},
            ${input.saturacionO2 ?? null},
            ${input.escalaDolor ?? null},
            ${input.pesoKg ?? null},
            ${input.tallaCm ?? null},
            ${imc},
            ${input.glucometriaMgdl ?? null},
            ${input.observaciones ?? null},
            ${input.fechaHoraToma ? new Date(input.fechaHoraToma) : new Date()},
            'borrador',
            ${input.glasgowOcular ?? null},
            ${input.glasgowVerbal ?? null},
            ${input.glasgowMotor ?? null},
            ${glasgowTotal},
            ${input.fio2 ?? null},
            ${input.perimetroCintura ?? null},
            ${ict},
            ${input.balanceHidrico ?? null},
            ${input.diuresis ?? null},
            ${input.fur ?? null}::date,
            ${input.fpp ?? null}::date,
            ${input.pesoLb ?? null},
            ${input.tallaFt ?? null},
            ${input.fppActivo ?? null},
            ${input.goGestas ?? null},
            ${input.goPartosTermino ?? null},
            ${input.goPartosPretermino ?? null},
            ${input.goAbortos ?? null},
            ${input.goVivos ?? null}
          )
          RETURNING id::text
        `;

        return { id: rows[0]!.id, episodioId, publicPatientId, publicEncounterId };
      });

      // Fase 3 — si no vino cuentaId explícito, resolver la cuenta ACTIVA del
      // paciente y persistirla (toda toma queda vinculada a la cuenta).
      // Best-effort: si el paciente no tiene cuenta todavía, la toma queda
      // igual anclada por episodioId (CHECK chk_signos_vitales_ancla).
      let cuentaIdFinal = input.cuentaId ?? null;
      if (!cuentaIdFinal && resultado.publicPatientId) {
        const account = await resolveCuentaActivaDePaciente(
          ctx.prisma,
          ctx.tenant,
          resultado.publicPatientId,
          resultado.publicEncounterId,
        );
        if (account) {
          cuentaIdFinal = account.id;
          await withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
            await tx.$executeRaw`
              UPDATE ece.signos_vitales SET cuenta_id = ${account.id}::uuid WHERE id = ${resultado.id}::uuid
            `;
          });
        }
      }

      return { id: resultado.id, episodioId: resultado.episodioId, cuentaId: cuentaIdFinal };
    }),

  /**
   * Actualiza una toma SOLO si está en estado "borrador".
   */
  update: tomaWrite
    .input(
      z.object({
        id: z.string().uuid(),
        data: eceSignosVitalesUpdateSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        // Verificar que existe y está en borrador
        const rows = await tx.$queryRaw<{
          estado_registro: string;
          peso_kg: number | null;
          talla_cm: number | null;
          perimetro_cintura: number | null;
          glasgow_ocular: number | null;
          glasgow_verbal: number | null;
          glasgow_motor: number | null;
        }[]>`
          SELECT estado_registro, peso_kg, talla_cm, perimetro_cintura,
                 glasgow_ocular, glasgow_verbal, glasgow_motor
          FROM ece.signos_vitales WHERE id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Toma no encontrada." });
        }

        if (rows[0].estado_registro !== "borrador") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden editar tomas en estado 'borrador'. Estado actual: '${rows[0].estado_registro}'.`,
          });
        }

        const d: EceSignosVitalesUpdateInput = input.data;

        // Recalcular IMC si peso o talla cambian
        const newPeso = d.pesoKg ?? rows[0].peso_kg;
        const newTalla = d.tallaCm ?? rows[0].talla_cm;
        const imc = calcularImc(newPeso, newTalla);

        // Recalcular Glasgow Total si algún componente cambia
        const newGlasgowOcular = d.glasgowOcular ?? rows[0].glasgow_ocular;
        const newGlasgowVerbal = d.glasgowVerbal ?? rows[0].glasgow_verbal;
        const newGlasgowMotor = d.glasgowMotor ?? rows[0].glasgow_motor;
        const glasgowTotal = calcularGlasgowTotal(newGlasgowOcular, newGlasgowVerbal, newGlasgowMotor);

        // Recalcular ICT si cintura o talla cambian
        const newCintura = d.perimetroCintura ?? rows[0].perimetro_cintura;
        const ict = calcularIct(newCintura, newTalla);

        await tx.$executeRaw`
          UPDATE ece.signos_vitales SET
            presion_sistolica       = COALESCE(${d.presionSistolica ?? null}, presion_sistolica),
            presion_diastolica      = COALESCE(${d.presionDiastolica ?? null}, presion_diastolica),
            frecuencia_cardiaca     = COALESCE(${d.frecuenciaCardiaca ?? null}, frecuencia_cardiaca),
            frecuencia_respiratoria = COALESCE(${d.frecuenciaRespiratoria ?? null}, frecuencia_respiratoria),
            temperatura             = COALESCE(${d.temperatura ?? null}, temperatura),
            saturacion_o2           = COALESCE(${d.saturacionO2 ?? null}, saturacion_o2),
            escala_dolor            = COALESCE(${d.escalaDolor ?? null}, escala_dolor),
            peso_kg                 = COALESCE(${d.pesoKg ?? null}, peso_kg),
            talla_cm                = COALESCE(${d.tallaCm ?? null}, talla_cm),
            imc                     = COALESCE(${imc}, imc),
            glucometria_mgdl        = COALESCE(${d.glucometriaMgdl ?? null}, glucometria_mgdl),
            observaciones           = COALESCE(${d.observaciones ?? null}, observaciones),
            fecha_hora_toma         = COALESCE(${d.fechaHoraToma ? new Date(d.fechaHoraToma) : null}::timestamptz, fecha_hora_toma),
            glasgow_ocular          = COALESCE(${d.glasgowOcular ?? null}, glasgow_ocular),
            glasgow_verbal          = COALESCE(${d.glasgowVerbal ?? null}, glasgow_verbal),
            glasgow_motor           = COALESCE(${d.glasgowMotor ?? null}, glasgow_motor),
            glasgow_total           = COALESCE(${glasgowTotal}, glasgow_total),
            fio2                    = COALESCE(${d.fio2 ?? null}, fio2),
            perimetro_cintura       = COALESCE(${d.perimetroCintura ?? null}, perimetro_cintura),
            ict                     = COALESCE(${ict}, ict),
            balance_hidrico         = COALESCE(${d.balanceHidrico ?? null}, balance_hidrico),
            diuresis                = COALESCE(${d.diuresis ?? null}, diuresis),
            fur                     = COALESCE(${d.fur ?? null}::date, fur),
            fpp                     = COALESCE(${d.fpp ?? null}::date, fpp),
            peso_lb                 = COALESCE(${d.pesoLb ?? null}, peso_lb),
            talla_ft                = COALESCE(${d.tallaFt ?? null}, talla_ft),
            fpp_activo              = COALESCE(${d.fppActivo ?? null}, fpp_activo),
            go_gestas               = COALESCE(${d.goGestas ?? null}, go_gestas),
            go_partos_termino       = COALESCE(${d.goPartosTermino ?? null}, go_partos_termino),
            go_partos_pretermino    = COALESCE(${d.goPartosPretermino ?? null}, go_partos_pretermino),
            go_abortos              = COALESCE(${d.goAbortos ?? null}, go_abortos),
            go_vivos                = COALESCE(${d.goVivos ?? null}, go_vivos),
            registrado_en           = now()
          WHERE id = ${input.id}::uuid
        `;

        return { ok: true as const };
      });
    }),

  /**
   * Firma la toma (ENF). Transición borrador → firmado.
   *
   * Crea/actualiza instancia en ece.documento_instancia + inserta historial
   * con hash SHA-256 del payload (auditoría inmutable).
   */
  firmar: nurseOnly
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<(SignosVitalesRow & { estado_registro: string })[]>`
          SELECT sv.*, sv.episodio_id::text AS episodio_id
          FROM ece.signos_vitales sv
          WHERE sv.id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Toma no encontrada." });
        }

        const sv = rows[0];

        if (sv.estado_registro !== "borrador") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden firmar tomas en 'borrador'. Estado actual: '${sv.estado_registro}'.`,
          });
        }

        // Resolver metadata de documento (tipoDocumentoId + estadoId "firmado")
        const { tipoDocumentoId, estadoId: estadoFirmadoId } = await resolveDocMetadata(
          tx,
          "firmado",
        );

        // Obtener también el estadoId "borrador" para el historial
        const estadoBorradorRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT fe.id::text
          FROM ece.flujo_estado fe
          JOIN ece.tipo_documento td ON td.id = fe.tipo_documento_id
          WHERE td.codigo = 'SIG_VIT' AND fe.codigo = 'borrador'
          LIMIT 1
        `;

        // Transición en signos_vitales
        await tx.$executeRaw`
          UPDATE ece.signos_vitales
          SET estado_registro = 'firmado', registrado_en = now()
          WHERE id = ${input.id}::uuid
        `;

        // Upsert instancia de documento
        const { instanciaId, isNew } = await upsertDocInstancia(tx, {
          signosVitalesId: input.id,
          episodioId: sv.episodio_id,
          tipoDocumentoId,
          estadoId: estadoFirmadoId,
          personalId,
        });

        // Actualizar estado de la instancia si ya existía
        if (!isNew) {
          await tx.$executeRaw`
            UPDATE ece.documento_instancia
            SET estado_actual_id = ${estadoFirmadoId}::uuid, version = version + 1
            WHERE id = ${instanciaId}::uuid
          `;
        }

        // Insertar historial con hash
        await insertHistorial(tx, {
          instanciaId,
          estadoAnteriorId: estadoBorradorRows[0]?.id ?? null,
          estadoNuevoId: estadoFirmadoId,
          accion: "firmar",
          personalId,
          payload: { signosVitalesId: input.id, firmadoEn: new Date().toISOString() },
        });

        return { ok: true as const, instanciaId };
      });
    }),

  /**
   * Valida la toma (ENF). Transición firmado → validado.
   */
  validar: nurseOnly
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const rows = await tx.$queryRaw<SignosVitalesRow[]>`
          SELECT sv.*, sv.episodio_id::text AS episodio_id
          FROM ece.signos_vitales sv
          WHERE sv.id = ${input.id}::uuid LIMIT 1
        `;

        if (!rows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Toma no encontrada." });
        }

        const sv = rows[0];

        if (sv.estado_registro !== "firmado") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden validar tomas en estado 'firmado'. Estado actual: '${sv.estado_registro}'.`,
          });
        }

        const { estadoId: estadoValidadoId } = await resolveDocMetadata(tx, "validado");

        const estadoFirmadoRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT fe.id::text
          FROM ece.flujo_estado fe
          JOIN ece.tipo_documento td ON td.id = fe.tipo_documento_id
          WHERE td.codigo = 'SIG_VIT' AND fe.codigo = 'firmado'
          LIMIT 1
        `;

        await tx.$executeRaw`
          UPDATE ece.signos_vitales
          SET estado_registro = 'validado', registrado_en = now()
          WHERE id = ${input.id}::uuid
        `;

        // Obtener instancia asociada
        const instanciaRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM ece.documento_instancia
          WHERE registro_id = ${input.id}::uuid LIMIT 1
        `;

        if (!instanciaRows[0]) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "La toma no tiene instancia de documento. Firme primero.",
          });
        }

        const instanciaId = instanciaRows[0].id;

        await tx.$executeRaw`
          UPDATE ece.documento_instancia
          SET estado_actual_id = ${estadoValidadoId}::uuid, version = version + 1
          WHERE id = ${instanciaId}::uuid
        `;

        await insertHistorial(tx, {
          instanciaId,
          estadoAnteriorId: estadoFirmadoRows[0]?.id ?? null,
          estadoNuevoId: estadoValidadoId,
          accion: "validar",
          personalId,
          payload: { signosVitalesId: input.id, validadoEn: new Date().toISOString() },
        });

        return { ok: true as const };
      });
    }),
});

// ─── Helper de contexto ──────────────────────────────────────────────────────

/**
 * Extrae personalId y establecimientoId del contexto tRPC.
 * El personalId usa ctx.user.id como proxy hasta que ece.personal_salud
 * esté completamente integrado (mismo patrón que workflow-instance.router.ts).
 */
function resolveEceIds(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string };
}): { personalId: string; establecimientoId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar signos vitales ECE.",
    });
  }
  return {
    personalId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
  };
}
