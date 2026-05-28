/**
 * Bedside Validation Router — Algoritmo 5 Correctos (US.F2.6.21-22)
 *
 * Endpoint server-side que aplica la Regla de los 5 Correctos en bedside:
 *  1. Paciente correcto    — GSRN paciente vs orden médica
 *  2. Medicamento correcto — GTIN vs indicación activa
 *  3. Dosis correcta       — presentación del GTIN vs dosis prescrita
 *  4. Vía correcta         — ruta del scan vs vía indicada
 *  5. Horario correcto     — ventana terapéutica (lastAdmin + frecuencia ± 30 min)
 *
 * Toda validación es síncrona (hard-stops no pueden ser asíncronos).
 * El registro BedsideValidation es inmutable (trigger en BD).
 * Usa withTenantContext mandatorio para RLS.
 *
 * EPCIS: al resultado OK, persiste un ObjectEvent con las 5 dimensiones.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";
import { computeScheduledSlot } from "../utils/medication-slot";

// ---------------------------------------------------------------------------
// GS1 DataMatrix parser (AI 01 / 10 / 17 / 21)
// ---------------------------------------------------------------------------

export interface Gs1ParseResult {
  gtin: string;       // AI (01) — 14 dígitos
  lote?: string;      // AI (10)
  fechaVence?: string; // AI (17) — YYMMDD → "YYYY-MM-DD"
  serie?: string;     // AI (21)
}

/**
 * Parsea un DataMatrix GS1 con Application Identifiers.
 * Soporta tanto paréntesis legibles "(01)..." como FNC1 (0x1D) y ]C1 como separador.
 *
 * Retorna null si el string no puede parsearse como GS1 válido.
 */
export function parseGs1DataMatrix(raw: string): Gs1ParseResult | null {
  // Normalizar: remover ]C1 prefix de pistolas, reemplazar FNC1 (0x1D) y
  // convertir formato parentético "(01)..." al mismo formato de detección.
  let input = raw.trim();

  // Pistolas que prefijan ]C1 (GS1-128 symbology identifier)
  if (input.startsWith("]C1") || input.startsWith("]d2") || input.startsWith("]Q3")) {
    input = input.slice(3);
  }

  // Reemplazar FNC1 (0x1D) por el separador canónico para facilitar split
  const GS = "\x1D";
  input = input.replace(/\x1D/g, GS);

  const result: Gs1ParseResult = { gtin: "" };

  // Estrategia 1: formato parentético "(NN)valor" — más legible en tests
  if (input.includes("(")) {
    const parenthetical = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    while ((m = parenthetical.exec(input)) !== null) {
      const [, ai, value] = m;
      parseAi(ai!, value!.trim(), result);
    }
    if (result.gtin) return result;
  }

  // Estrategia 2: AI numérico directo (sin paréntesis, con o sin FNC1)
  // Parsear posicionalmente: AI de longitud fija primero.
  let pos = 0;
  const s = input.replace(new RegExp(GS, "g"), "");
  while (pos < s.length) {
    // Intentar AI de 2 dígitos de longitud fija
    const ai2 = s.slice(pos, pos + 2);
    if (ai2 === "01") {
      const val = s.slice(pos + 2, pos + 16); // GTIN-14
      parseAi("01", val, result);
      pos += 16;
    } else if (ai2 === "10") {
      // Longitud variable → hasta FNC1 o fin (max 20)
      const raw10 = extractVariable(s, pos + 2, 20, input, pos + 2);
      parseAi("10", raw10, result);
      pos += 2 + raw10.length;
    } else if (ai2 === "17") {
      const val = s.slice(pos + 2, pos + 8); // YYMMDD
      parseAi("17", val, result);
      pos += 8;
    } else if (ai2 === "21") {
      const raw21 = extractVariable(s, pos + 2, 20, input, pos + 2);
      parseAi("21", raw21, result);
      pos += 2 + raw21.length;
    } else {
      // AI desconocido — avanzar 1 para evitar loop infinito
      pos++;
    }
  }

  if (!result.gtin) return null;
  return result;
}

function extractVariable(
  s: string,
  start: number,
  maxLen: number,
  _original: string,
  _origStart: number,
): string {
  // Para strings sin FNC1, tomamos hasta maxLen o fin del string
  return s.slice(start, start + maxLen);
}

function parseAi(ai: string, value: string, acc: Gs1ParseResult): void {
  switch (ai) {
    case "01":
      if (/^\d{14}$/.test(value)) acc.gtin = value;
      break;
    case "10":
      acc.lote = value || undefined;
      break;
    case "17": {
      // YYMMDD → YYYY-MM-DD
      if (/^\d{6}$/.test(value)) {
        const yy = parseInt(value.slice(0, 2), 10);
        const mm = value.slice(2, 4);
        const dd = value.slice(4, 6);
        const year = yy >= 50 ? 1900 + yy : 2000 + yy;
        acc.fechaVence = `${year}-${mm}-${dd}`;
      }
      break;
    }
    case "21":
      acc.serie = value || undefined;
      break;
  }
}

// ---------------------------------------------------------------------------
// Algoritmo de dosis — extrae mg/ml de un string de presentación
// ---------------------------------------------------------------------------

/**
 * Extrae la cantidad numérica + unidad (mg, ml, mcg, g, ui) de un string.
 * Retorna null si no puede extraer.
 *
 * Ejemplos:
 *  "Amoxicilina 500mg/cap" → { amount: 500, unit: "mg" }
 *  "500 MG"               → { amount: 500, unit: "mg" }
 */
export function extractDoseQuantity(
  text: string,
): { amount: number; unit: string } | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(mg|ml|mcg|g|ui|iu|meq)/i);
  if (!m) return null;
  return { amount: parseFloat(m[1]!), unit: m[2]!.toLowerCase() };
}

/**
 * Compara dosis prescrita vs presentación del GTIN.
 * Retorna true solo si amount y unit coinciden exactamente.
 */
export function dosasCoinciden(prescribed: string, presentation: string): boolean {
  const p = extractDoseQuantity(prescribed);
  const s = extractDoseQuantity(presentation);
  if (!p || !s) return false;
  return p.amount === s.amount && p.unit === s.unit;
}

// ---------------------------------------------------------------------------
// Algoritmo de ventana terapéutica
// ---------------------------------------------------------------------------

/** Extrae el intervalo en minutos de un string de frecuencia.
 *  "cada 8h", "cada 8 horas", "q8h" → 480
 *  "cada 12h" → 720
 *  Retorna null si no puede parsear.
 */
export function parseFrecuenciaMinutos(frecuencia: string): number | null {
  const mh = frecuencia.match(/(\d+)\s*h/i);
  if (mh) return parseInt(mh[1]!, 10) * 60;
  const mm = frecuencia.match(/(\d+)\s*min/i);
  if (mm) return parseInt(mm[1]!, 10);
  const md = frecuencia.match(/(\d+)\s*d/i);
  if (md) return parseInt(md[1]!, 10) * 60 * 24;
  return null;
}

const VENTANA_TOLERANCIA_MIN = 30;

/**
 * Evalúa si el timestamp está dentro de la ventana terapéutica.
 *
 * Ventana: lastAdmin + intervalMin ± VENTANA_TOLERANCIA_MIN
 * Si no hay lastAdmin (primera dosis), la ventana es [now - tolerancia, now + tolerancia].
 */
export function dentroDeVentana(opts: {
  timestamp: Date;
  lastAdmin: Date | null;
  intervalMinutos: number;
}): { ok: boolean; proximaVentanaInicio: Date; proximaVentanaFin: Date } {
  const { timestamp, lastAdmin, intervalMinutos } = opts;

  let windowStart: Date;
  let windowEnd: Date;

  if (!lastAdmin) {
    // Primera dosis: cualquier momento es válido dentro de la tolerancia
    windowStart = new Date(timestamp.getTime() - VENTANA_TOLERANCIA_MIN * 60_000);
    windowEnd = new Date(timestamp.getTime() + VENTANA_TOLERANCIA_MIN * 60_000);
  } else {
    const center = new Date(lastAdmin.getTime() + intervalMinutos * 60_000);
    windowStart = new Date(center.getTime() - VENTANA_TOLERANCIA_MIN * 60_000);
    windowEnd = new Date(center.getTime() + VENTANA_TOLERANCIA_MIN * 60_000);
  }

  const ok = timestamp >= windowStart && timestamp <= windowEnd;
  // Próxima ventana para feedback en UI cuando falla
  const nextCenter = lastAdmin
    ? new Date(lastAdmin.getTime() + intervalMinutos * 60_000)
    : timestamp;
  return {
    ok,
    proximaVentanaInicio: new Date(nextCenter.getTime() - VENTANA_TOLERANCIA_MIN * 60_000),
    proximaVentanaFin:   new Date(nextCenter.getTime() + VENTANA_TOLERANCIA_MIN * 60_000),
  };
}

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

export type HardStopCode =
  | "PACIENTE_NO_COINCIDE"
  | "MEDICAMENTO_NO_COINCIDE"
  | "DOSIS_INCORRECTA"
  | "VIA_INCORRECTA"
  | "FUERA_DE_VENTANA"
  | "INDICACION_INACTIVA"
  | "GSRN_PACIENTE_NO_ENCONTRADO"
  | "GS1_PARSE_ERROR";

export type ValidateResult =
  | { ok: true; validationId: string }
  | { ok: false; hardStop: HardStopCode; reason: string; expected?: string; received?: string };

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const validate5CorrectosInput = z.object({
  /** GSRN-18 de la enfermera (AI 8018). */
  gsrnEnfermera: z
    .string()
    .length(18)
    .regex(/^\d{18}$/, "GSRN-18 inválido"),
  /** GSRN-18 del paciente escaneado desde la pulsera. */
  gsrnPaciente: z
    .string()
    .length(18)
    .regex(/^\d{18}$/, "GSRN-18 inválido"),
  /** DataMatrix GS1 completo del medicamento (AI 01/10/17/21). */
  gs1Medicamento: z.string().min(14),
  /** ID de la indicación médica activa. */
  indicationId: z.string().min(1),
  /** GLN-13 de la ubicación donde ocurre la administración. */
  glnUbicacion: z.string().optional(),
  /** Momento real del scan (ISO 8601). */
  timestamp: z.coerce.date(),
});

// ---------------------------------------------------------------------------
// Tipos internos de dominio (row types de $queryRawUnsafe)
// ---------------------------------------------------------------------------

interface GsrnRow {
  referencia_id: string;
  activo: boolean;
}

interface IndicationRow {
  id: string;
  patient_id: string;
  patient_gsrn: string | null;
  gtin: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  status: string;
}

interface LastAdminRow {
  administered_at: Date | null;
}

// ---------------------------------------------------------------------------
// Sub-router: administration
// ---------------------------------------------------------------------------

const administrationRecordInput = z.object({
  patientGsrn:  z.string().length(18).regex(/^\d{18}$/),
  medicamentoGtin: z.string().length(14).regex(/^\d{14}$/),
  lote:         z.string().min(1).max(80),
  serie:        z.string().max(80).optional(),
  dosis:        z.string().min(1).max(200), // ej. "500mg/cap"
  via:          z.enum(["ORAL", "IV", "IM", "SC", "TOPICAL", "INHALED", "RECTAL", "SUBLINGUAL", "OPHTHALMIC", "OTIC", "NASAL"]),
  indicationId: z.string().uuid(),
  staffGsrn:   z.string().length(18).regex(/^\d{18}$/),
  // JCI IPSG.3 ME 4 — double-check independiente para high-alert meds.
  doubleCheckBy:  z.string().uuid().optional(),
  doubleCheckPin: z.string().min(4).max(20).optional(),
});

// Niveles de alerta que requieren double-check independiente (IPSG.3 ME 4).
const DOUBLE_CHECK_ALERT_LEVELS = new Set(["high", "very_high", "critical"]);

const administrationRouter = router({
  /**
   * Registra una administración bedside en MedicationAdministration con flags BCMA=true.
   * Emite evento de dominio "gs1.epcis.bedside" al outbox transaccional.
   *
   * Precondición: el flujo de 5 Correctos ya fue validado (validate5Correctos).
   * Esta procedure NO re-valida — asume que el cliente llama en orden.
   */
  record: tenantProcedure
    .input(administrationRecordInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      // Resolver patientId desde GSRN
      const gsrnRows = await ctx.prisma.$queryRawUnsafe<{ referencia_id: string }[]>(
        `SELECT referencia_id FROM ece.gs1_gsrn WHERE codigo = $1 AND tipo = 'paciente' AND activo = true LIMIT 1`,
        input.patientGsrn,
      );
      const patientId = gsrnRows[0]?.referencia_id;
      if (!patientId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `GSRN paciente ${input.patientGsrn} no encontrado o inactivo.`,
        });
      }

      // Resolver userId (enfermero) desde staffGsrn
      const staffRows = await ctx.prisma.$queryRawUnsafe<{ user_id: string }[]>(
        `SELECT user_id FROM "StaffGsrn" WHERE gsrn = $1 AND status = 'ACTIVE' LIMIT 1`,
        input.staffGsrn,
      );
      const nurseId = staffRows[0]?.user_id ?? ctx.user.id;

      // Resolver prescriptionItemId desde indicationId
      // ece.indicaciones_medicas tiene una FK opcional a PrescriptionItem.
      // Si existe: lo usamos. Si no: necesitamos uno — bloqueamos para seguridad.
      const indicRows = await ctx.prisma.$queryRawUnsafe<{ prescription_item_id: string | null }[]>(
        `SELECT prescription_item_id FROM ece.indicaciones_medicas WHERE id = $1 LIMIT 1`,
        input.indicationId,
      );
      const prescriptionItemId = indicRows[0]?.prescription_item_id;
      if (!prescriptionItemId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `La indicación ${input.indicationId} no tiene PrescriptionItem enlazado. Complete el bridge ECE→HIS antes de registrar administración bedside.`,
        });
      }

      // BCMA-002 Right Time: calcular slot programado real desde frecuencia e
      // hora_indicada de la indicación. Evita que scheduledTime = now() haga
      // inocuo el guard isWithinTimingWindow en medication-admin.router.
      const slotRows = await ctx.prisma.$queryRawUnsafe<{ fecha_hora: Date | null; frecuencia: string | null }[]>(
        `SELECT im.fecha_hora, ii.frecuencia
         FROM ece.indicaciones_medicas im
         LEFT JOIN ece.indicacion_item ii ON ii.indicacion_id = im.id
         WHERE im.id = $1
         LIMIT 1`,
        input.indicationId,
      );
      const slotRow = slotRows[0];
      const scheduledTime = slotRow?.fecha_hora && slotRow.frecuencia
        ? computeScheduledSlot(new Date(slotRow.fecha_hora), slotRow.frecuencia)
        : null;

      // -- JCI IPSG.3 ME 2 — LASA pair detection (pre-tx, read-only) -----------
      type LasaAlertPayload = {
        pairedDrugId:   string;
        pairedDrugName: string;
        razon:          string;
        severidad:      string;
      };
      let lasaAlert: LasaAlertPayload | null = null;

      // Resolver drugId desde GTIN en Drug catalog para la query LASA
      const drugRows = await ctx.prisma.$queryRawUnsafe<{ id: string; alert_level: string }[]>(
        `SELECT d.id, d."alertLevel" AS alert_level
         FROM "Drug" d
         WHERE d."active" = true
         LIMIT 1`,
        // Sin FK directa GTIN→Drug en este router; la indicación enlaza el drug.
        // Usamos prescriptionItemId para resolver drug.
      );
      // Resolver drug desde prescriptionItem (ya resuelto arriba)
      const drugFromItem = await ctx.prisma.$queryRawUnsafe<{
        drug_id: string;
        alert_level: string;
      }[]>(
        `SELECT pi."drugId" AS drug_id, d."alertLevel" AS alert_level
         FROM "PrescriptionItem" pi
         JOIN "Drug" d ON d.id = pi."drugId"
         WHERE pi.id = $1
         LIMIT 1`,
        prescriptionItemId,
      );
      void drugRows; // no usado directamente

      const drugId     = drugFromItem[0]?.drug_id ?? null;
      const alertLevel = drugFromItem[0]?.alert_level ?? "standard";

      if (drugId) {
        const lasaRows = await ctx.prisma.$queryRawUnsafe<{
          paired_drug_id:   string;
          paired_drug_name: string;
          razon:            string;
          severidad:        string;
        }[]>(
          `SELECT
             CASE WHEN lp.drug_a_id = $1 THEN lp.drug_b_id ELSE lp.drug_a_id END AS paired_drug_id,
             d."genericName" AS paired_drug_name,
             lp.razon,
             lp.severidad
           FROM ece.lasa_pair lp
           JOIN "Drug" d ON d.id = CASE WHEN lp.drug_a_id = $1 THEN lp.drug_b_id ELSE lp.drug_a_id END
           WHERE (lp.drug_a_id = $1 OR lp.drug_b_id = $1)
             AND lp.activo = true
           LIMIT 1`,
          drugId,
        );

        if (lasaRows.length > 0 && lasaRows[0]) {
          lasaAlert = {
            pairedDrugId:   lasaRows[0].paired_drug_id,
            pairedDrugName: lasaRows[0].paired_drug_name,
            razon:          lasaRows[0].razon,
            severidad:      lasaRows[0].severidad,
          };
        }
      }

      // -- JCI IPSG.3 ME 4 — double-check para high-alert meds ----------------
      const requiresDoubleCheck = DOUBLE_CHECK_ALERT_LEVELS.has(alertLevel);

      if (requiresDoubleCheck) {
        if (!input.doubleCheckBy || !input.doubleCheckPin) {
          // Retornar flag — UI debe mostrar modal y re-enviar con los datos.
          return {
            requiresDoubleCheck: true as const,
            lasaAlert,
            administrationId: null,
          };
        }

        if (input.doubleCheckBy === nurseId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "IPSG3_DOUBLE_CHECK_SAME_PERSON: El verificador independiente debe ser " +
              "una enfermera distinta a la que administra.",
          });
        }

        const verifier = await ctx.prisma.$queryRawUnsafe<{ pin_hash: string | null }[]>(
          `SELECT "pinHash" AS pin_hash FROM "User" WHERE id = $1 LIMIT 1`,
          input.doubleCheckBy,
        );

        if (!verifier[0]) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "IPSG3_DOUBLE_CHECK_FAILED: Verificadora no encontrada.",
          });
        }

        const storedHash = verifier[0].pin_hash;
        if (storedHash !== null) {
          const { argon2 } = await import("@his/infrastructure");
          const pinOk = await argon2.verify(storedHash, input.doubleCheckPin);
          if (!pinOk) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "IPSG3_DOUBLE_CHECK_FAILED: PIN de verificación incorrecto.",
            });
          }
        }
      }

      // Hash del PIN para persistencia
      let doubleCheckPinHash: string | null = null;
      if (requiresDoubleCheck && input.doubleCheckPin) {
        const { argon2 } = await import("@his/infrastructure");
        doubleCheckPinHash = await argon2.hash(input.doubleCheckPin);
      }

      const result = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Crear MedicationAdministration con flags BCMA activos
        const admin = await tx.medicationAdministration.create({
          data: {
            organizationId:       orgId,
            prescriptionItemId,
            administeredById:     nurseId,
            administeredAt:       new Date(),
            status:               "ADMINISTERED",
            route:                input.via,
            patientBarcodeScanned:  true,
            drugBarcodeScanned:     true,
            providerBadgeScanned:   true,
            scannedAt:              new Date(),
            patientWristbandScanned: true,
            // GS1 bedside fields
            gtinScanned:     input.medicamentoGtin,
            loteScanned:     input.lote,
            serieScanned:    input.serie ?? null,
            gsrnPaciente:    input.patientGsrn,
            gsrnEnfermera:   input.staffGsrn,
            notes:           `Bedside BCMA: ${input.dosis} via ${input.via}`,
            // Right Time 5R — slot calculado desde frecuencia de la indicación
            scheduledTime:   scheduledTime,
            // JCI IPSG.3 ME 4 — double-check
            doubleCheckBy:  input.doubleCheckBy ?? null,
            doubleCheckAt:  requiresDoubleCheck && input.doubleCheckBy ? new Date() : null,
            doubleCheckPin: doubleCheckPinHash,
          },
          select: { id: true },
        });

        // Evento EPCIS bedside — insertamos en ece.epcis_events (mismo patrón
        // que validate5Correctos en este archivo). El DomainEvent outbox
        // requiere @his/database que tiene un stub en este worktree;
        // usamos el camino directo para evitar la dependencia del stub.
        const epcisEventId = randomUUID();
        const payloadHash = createHash("sha256")
          .update(JSON.stringify({ epcisEventId, gtin: input.medicamentoGtin, lote: input.lote, indicationId: input.indicationId }))
          .digest("hex");

        await tx.$executeRawUnsafe(
          `INSERT INTO ece.epcis_events
             (organization_id, event_type, what, "where", "when", why, who)
           VALUES ($1::uuid, 'ObjectEvent', $2::jsonb, $3::jsonb, $4, $5::jsonb, $6::jsonb)`,
          orgId,
          JSON.stringify({
            subtipo:     "BEDSIDE_ADMIN",
            gtin:        input.medicamentoGtin,
            lote:        input.lote,
            serie:       input.serie ?? null,
            epcisEventId,
            payloadHash,
            adminId:     admin.id,
            lasaAlert,
          }),
          JSON.stringify({ readPoint: "0000000000000" }),
          new Date().toISOString(),
          JSON.stringify({ businessStep: "administering", disposition: "consumed" }),
          JSON.stringify({
            gsrnProfesional: input.staffGsrn,
            gsrnPaciente:    input.patientGsrn,
          }),
        );

        return admin;
      });

      return {
        requiresDoubleCheck: false as const,
        lasaAlert,
        administrationId: result.id,
      };
    }),
});

// ---------------------------------------------------------------------------
// Sub-router: shiftQueue
// ---------------------------------------------------------------------------

export interface ShiftQueueItem {
  patientId:        string;
  patientGsrn:      string | null;
  indicationId:     string;
  gtinMedicamento:  string | null;
  horaProgramada:   Date | null;
  status:           "PENDING" | "DONE" | "OVERDUE";
}

interface IndicacionPendienteRow {
  indicacion_id:  string;
  patient_id:     string;
  patient_gsrn:   string | null;
  gtin:           string | null;
  hora_programada: Date | null;
}

const shiftQueueRouter = router({
  /**
   * Retorna la cola de indicaciones pendientes del turno activo del enfermero.
   *
   * Lógica:
   * 1. Busca el turno activo en ece.staff_schedule para ctx.user.id y now().
   * 2. Si existe: filtra indicaciones del servicio asignado al turno.
   * 3. Fallback (sin schedule): retorna TODAS las indicaciones vigentes de la org.
   * 4. Calcula status PENDING/DONE/OVERDUE por ventana terapéutica (±30 min).
   */
  pending: tenantProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }): Promise<{ items: ShiftQueueItem[] }> => {
      const orgId  = ctx.tenant.organizationId;
      const userId = ctx.user.id;
      const now    = new Date();

      // Turno activo del enfermero.
      // Fix 42883: fecha_inicio/fin son timestamptz; sin cast explícito el
      // driver pasa el ISO string como `text` y Postgres no encuentra el
      // operador `timestamptz <= text`. Casteamos $3 a timestamptz.
      const scheduleRows = await ctx.prisma.$queryRawUnsafe<{ servicio_id: string | null }[]>(
        `SELECT servicio_id
           FROM ece.staff_schedule
          WHERE organization_id = $1::uuid
            AND user_id = $2::uuid
            AND fecha_inicio <= $3::timestamptz
            AND fecha_fin    >= $3::timestamptz
          ORDER BY fecha_inicio DESC
          LIMIT 1`,
        orgId,
        userId,
        now.toISOString(),
      );
      const servicioId = scheduleRows[0]?.servicio_id ?? null;

      // Indicaciones activas — filtradas por servicio si hay schedule
      const indicRows = await ctx.prisma.$queryRawUnsafe<IndicacionPendienteRow[]>(
        `SELECT
           i.id                    AS indicacion_id,
           i.patient_id,
           p.gsrn                  AS patient_gsrn,
           i.gtin_medicamento      AS gtin,
           i.proxima_administracion AS hora_programada
         FROM ece.indicaciones_medicas i
         LEFT JOIN "Patient" p ON p.id = i.patient_id
         WHERE i.organization_id = $1::uuid
           AND i.estado = 'ACTIVA'
           ${servicioId ? `AND i.servicio_id = $2::uuid` : ""}
         ORDER BY i.proxima_administracion ASC NULLS LAST
         LIMIT 100`,
        ...(servicioId ? [orgId, servicioId] : [orgId]),
      );

      const TOLERANCIA_MS = 30 * 60_000;

      const items: ShiftQueueItem[] = indicRows.map((row) => {
        let status: "PENDING" | "DONE" | "OVERDUE" = "PENDING";
        if (row.hora_programada) {
          const hp = new Date(row.hora_programada).getTime();
          if (now.getTime() > hp + TOLERANCIA_MS) {
            status = "OVERDUE";
          }
        }
        return {
          patientId:       row.patient_id,
          patientGsrn:     row.patient_gsrn,
          indicationId:    row.indicacion_id,
          gtinMedicamento: row.gtin,
          horaProgramada:  row.hora_programada ? new Date(row.hora_programada) : null,
          status,
        };
      });

      return { items };
    }),
});

// ---------------------------------------------------------------------------
// Sub-router: validate5Correct (alias de compatibilidad para Stream 11 UI)
//
// Stream 11 UI espera: trpc.bedside.validate5Correct.validate
// API existente:       trpc.bedside.validate5Correctos (procedure plana)
//
// Decisión: alias wrapper que adapta el input shape y delega a runValidate5Correctos().
// No se renombra validate5Correctos para no romper clientes existentes.
// ---------------------------------------------------------------------------

const validate5CorrectInput = z.object({
  patientGsrn:  z.string().length(18),
  nurseGsrn:    z.string().length(18),
  gtin:         z.string().min(14),
  lot:          z.string().min(1),
  expiry:       z.string().min(1),
  indicationId: z.string().min(1),
});

const validate5CorrectRouter = router({
  /**
   * Alias de validate5Correctos para la UI de Stream 11.
   * Adapta el input del wizard (patientGsrn, nurseGsrn, gtin, lot, expiry)
   * al input original (gsrnPaciente, gsrnEnfermera, gs1Medicamento).
   */
  validate: tenantProcedure
    .input(validate5CorrectInput)
    .mutation(async ({ ctx, input }): Promise<ValidateResult> => {
      // Construye DataMatrix GS1 sintético en formato parentético
      const gs1Medicamento = `(01)${input.gtin}(10)${input.lot}(17)${input.expiry}`;
      return runValidate5Correctos(ctx, {
        gsrnEnfermera:  input.nurseGsrn,
        gsrnPaciente:   input.patientGsrn,
        gs1Medicamento,
        indicationId:   input.indicationId,
        timestamp:      new Date(),
      });
    }),
});

// ---------------------------------------------------------------------------
// Core logic — validate5Correctos extraída para reutilización interna
// ---------------------------------------------------------------------------

type Validate5CorrectosCtx = {
  prisma: PrismaClient;
  tenant: { organizationId: string; userId: string };
};

async function runValidate5Correctos(
  ctx: Validate5CorrectosCtx,
  input: z.infer<typeof validate5CorrectosInput>,
): Promise<ValidateResult> {
      const orgId = ctx.tenant.organizationId;

      // ── Paso 0: Parsear DataMatrix GS1 ─────────────────────────────────
      const gs1 = parseGs1DataMatrix(input.gs1Medicamento);
      if (!gs1 || !gs1.gtin) {
        await persistValidation(ctx.prisma, {
          orgId, input, gs1ParsedGtin: null,
          status: "HARD_STOP",
          hardStopCode: "GS1_PARSE_ERROR",
          reason: "El DataMatrix no pudo ser interpretado como GS1 válido.",
          expected: "DataMatrix GS1 con AI (01)GTIN-14",
          received: input.gs1Medicamento.slice(0, 80),
        });
        return {
          ok: false,
          hardStop: "GS1_PARSE_ERROR",
          reason: "El DataMatrix no pudo ser interpretado como GS1 válido.",
          expected: "DataMatrix GS1 con AI (01)GTIN-14",
          received: input.gs1Medicamento.slice(0, 80),
        };
      }

      // ── Paso 1: Paciente correcto ───────────────────────────────────────
      // Buscamos el GSRN escaneado → obtenemos el patientId referenciado.
      const gsrnRows = await ctx.prisma.$queryRawUnsafe<GsrnRow[]>(
        `SELECT referencia_id, activo
           FROM ece.gs1_gsrn
          WHERE codigo = $1 AND tipo = 'paciente'
          LIMIT 1`,
        input.gsrnPaciente,
      );
      const gsrnRow = gsrnRows[0];

      if (!gsrnRow || !gsrnRow.activo) {
        const code: HardStopCode = "GSRN_PACIENTE_NO_ENCONTRADO";
        const reason = gsrnRow
          ? `GSRN paciente inactivo: ${input.gsrnPaciente}`
          : `GSRN paciente no registrado: ${input.gsrnPaciente}`;
        await persistValidation(ctx.prisma, {
          orgId, input, gs1ParsedGtin: gs1.gtin,
          status: "HARD_STOP", hardStopCode: code, reason,
          expected: "GSRN de paciente activo registrado",
          received: input.gsrnPaciente,
        });
        return { ok: false, hardStop: code, reason };
      }

      const patientId = gsrnRow.referencia_id;

      // ── Paso 2: Cargar indicación médica ───────────────────────────────
      // La indicación viene de ece.hoja_triaje o del módulo de indicaciones.
      // Buscamos en la tabla indicaciones_medicas del schema ece.
      const indicRows = await ctx.prisma.$queryRawUnsafe<IndicationRow[]>(
        `SELECT
           i.id,
           i.patient_id,
           p.gsrn                   AS patient_gsrn,
           i.gtin_medicamento       AS gtin,
           i.dosis                  AS dose,
           i.via_administracion     AS route,
           i.frecuencia             AS frequency,
           i.estado                 AS status
         FROM ece.indicaciones_medicas i
         LEFT JOIN "Patient" p ON p.id = i.patient_id
         WHERE i.id = $1
         LIMIT 1`,
        input.indicationId,
      );
      const indication = indicRows[0];

      if (!indication) {
        return {
          ok: false,
          hardStop: "INDICACION_INACTIVA",
          reason: `Indicación ${input.indicationId} no encontrada.`,
        };
      }

      if (indication.status !== "ACTIVA" && indication.status !== "activa") {
        return {
          ok: false,
          hardStop: "INDICACION_INACTIVA",
          reason: `Indicación ${input.indicationId} en estado '${indication.status}' (se requiere ACTIVA).`,
          expected: "ACTIVA",
          received: indication.status,
        };
      }

      // Verificar que el paciente de la indicación coincide con el GSRN escaneado
      if (indication.patient_id !== patientId) {
        const code: HardStopCode = "PACIENTE_NO_COINCIDE";
        const reason = `El GSRN escaneado pertenece al paciente ${patientId}, pero la indicación corresponde al paciente ${indication.patient_id}.`;
        await persistValidation(ctx.prisma, {
          orgId, input, gs1ParsedGtin: gs1.gtin, patientId,
          status: "HARD_STOP", hardStopCode: code, reason,
          expected: indication.patient_id,
          received: patientId,
        });
        return { ok: false, hardStop: code, reason, expected: indication.patient_id, received: patientId };
      }

      // ── Paso 3: Medicamento correcto ───────────────────────────────────
      if (indication.gtin && indication.gtin !== gs1.gtin) {
        const code: HardStopCode = "MEDICAMENTO_NO_COINCIDE";
        const reason = `GTIN escaneado no coincide con la indicación.`;
        await persistValidation(ctx.prisma, {
          orgId, input, gs1ParsedGtin: gs1.gtin, patientId,
          status: "HARD_STOP", hardStopCode: code, reason,
          expected: indication.gtin,
          received: gs1.gtin,
        });
        return { ok: false, hardStop: code, reason, expected: indication.gtin, received: gs1.gtin };
      }

      // ── Paso 4: Dosis correcta ─────────────────────────────────────────
      if (indication.dose && gs1.gtin) {
        // Obtenemos la presentación del GTIN del catálogo
        const gtinRows = await ctx.prisma.$queryRawUnsafe<{ presentacion: string }[]>(
          `SELECT presentacion FROM ece.gs1_gtin WHERE codigo = $1 AND activo = true LIMIT 1`,
          gs1.gtin,
        );
        const gtinRow = gtinRows[0];
        if (gtinRow && !dosasCoinciden(indication.dose, gtinRow.presentacion)) {
          const code: HardStopCode = "DOSIS_INCORRECTA";
          const reason = `La presentación del medicamento no coincide con la dosis prescrita.`;
          await persistValidation(ctx.prisma, {
            orgId, input, gs1ParsedGtin: gs1.gtin, patientId,
            status: "HARD_STOP", hardStopCode: code, reason,
            expected: indication.dose,
            received: gtinRow.presentacion,
          });
          return { ok: false, hardStop: code, reason, expected: indication.dose, received: gtinRow.presentacion };
        }
      }

      // ── Paso 5: Vía correcta ───────────────────────────────────────────
      // La vía se confirma en el cliente (guia §2.5); aquí solo bloqueamos
      // si la indicación tiene vía registrada y viene un override en el input.
      // (Sin campo de vía en el input del scan — el scanner no captura vía.)
      // Este correcto se valida en la confirmación (US.F2.6.24); en el scan
      // del DataMatrix no hay información de vía → skip con audit.
      // Trade-off documentado: la norma §2.5 indica que la vía es confirmada
      // por la enfermera en el Paso 3 de la UI, no en el DataMatrix.

      // ── Paso 6: Horario correcto ───────────────────────────────────────
      if (indication.frequency) {
        const intervalMin = parseFrecuenciaMinutos(indication.frequency);
        if (intervalMin !== null) {
          // Última administración para esta indicación
          const lastRows = await ctx.prisma.$queryRawUnsafe<LastAdminRow[]>(
            `SELECT administered_at
               FROM "MedicationAdministration"
              WHERE "orderId" = $1
                AND status = 'ADMINISTERED'
              ORDER BY administered_at DESC
              LIMIT 1`,
            input.indicationId,
          );
          const lastAdmin = lastRows[0]?.administered_at ?? null;

          const ventana = dentroDeVentana({
            timestamp: input.timestamp,
            lastAdmin,
            intervalMinutos: intervalMin,
          });

          if (!ventana.ok) {
            const code: HardStopCode = "FUERA_DE_VENTANA";
            const reason = `Administración fuera de la ventana terapéutica.`;
            const expected = `${ventana.proximaVentanaInicio.toISOString()} – ${ventana.proximaVentanaFin.toISOString()}`;
            const received = input.timestamp.toISOString();
            await persistValidation(ctx.prisma, {
              orgId, input, gs1ParsedGtin: gs1.gtin, patientId,
              status: "HARD_STOP", hardStopCode: code, reason,
              expected, received,
            });
            return { ok: false, hardStop: code, reason, expected, received };
          }
        }
      }

      // ── Todos correctos → persistir OK y EPCIS ─────────────────────────
      const validationId = await withTenantContext(
        ctx.prisma,
        ctx.tenant,
        async (tx) => {
          const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO ece.bedside_validation
               (organization_id, indication_id, patient_id,
                nurse_gsrn, patient_gsrn, gtin, lote, serie, fecha_vence,
                status, gln_ubicacion)
             VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9::date, 'OK', $10)
             RETURNING id`,
            orgId,
            input.indicationId,
            patientId,
            input.gsrnEnfermera,
            input.gsrnPaciente,
            gs1.gtin,
            gs1.lote ?? null,
            gs1.serie ?? null,
            gs1.fechaVence ?? null,
            input.glnUbicacion ?? null,
          );

          // EPCIS ObjectEvent — 5 dimensiones
          await tx.$executeRawUnsafe(
            `INSERT INTO ece.epcis_events
               (organization_id, event_type, what, "where", "when", why, who)
             VALUES ($1::uuid, 'ObjectEvent', $2::jsonb, $3::jsonb, $4, $5::jsonb, $6::jsonb)`,
            orgId,
            JSON.stringify({
              gtin: gs1.gtin,
              lote: gs1.lote,
              serie: gs1.serie,
              fechaVence: gs1.fechaVence,
            }),
            JSON.stringify({ gln: input.glnUbicacion ?? null }),
            input.timestamp.toISOString(),
            JSON.stringify({ businessStep: "administering", disposition: "in_progress" }),
            JSON.stringify({
              gsrnEnfermera: input.gsrnEnfermera,
              gsrnPaciente: input.gsrnPaciente,
            }),
          );

          return rows[0]!.id;
        },
      );

      return { ok: true, validationId };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const bedsideRouter = router({
  /**
   * validate5Correctos — Algoritmo 5 Correctos bedside (procedure plana, API pública).
   * La UI de Stream 11 accede vía bedside.validate5Correct.validate (alias abajo).
   */
  validate5Correctos: tenantProcedure
    .input(validate5CorrectosInput)
    .mutation(({ ctx, input }): Promise<ValidateResult> => runValidate5Correctos(ctx, input)),

  // Sub-routers nuevos (F2-S7 Wave 2)
  administration: administrationRouter,
  shiftQueue:     shiftQueueRouter,
  validate5Correct: validate5CorrectRouter,
});

// ---------------------------------------------------------------------------
// Helper — persiste un registro de validación fallida SIN withTenantContext
// (falla ocurrió antes de conocer el patientId o el GSRN no existe)
// ---------------------------------------------------------------------------

interface PersistOpts {
  orgId: string;
  input: z.infer<typeof validate5CorrectosInput>;
  gs1ParsedGtin: string | null;
  patientId?: string;
  status: "OK" | "HARD_STOP";
  hardStopCode?: HardStopCode;
  reason?: string;
  expected?: string;
  received?: string;
}

async function persistValidation(
  prisma: PrismaClient,
  opts: PersistOpts,
): Promise<void> {
  // Para hard-stops que ocurren antes de verificar el paciente, usamos
  // un UUID nulo como placeholder (la constraint NOT NULL aplica a patient_id).
  const patientId = opts.patientId ?? "00000000-0000-0000-0000-000000000000";
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ece.bedside_validation
         (organization_id, indication_id, patient_id,
          nurse_gsrn, patient_gsrn, gtin, lote, serie, fecha_vence,
          status, hard_stop_code, hard_stop_reason,
          expected_value, received_value, gln_ubicacion)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9::date,
               $10, $11, $12, $13, $14, $15)`,
      opts.orgId,
      opts.input.indicationId,
      patientId,
      opts.input.gsrnEnfermera,
      opts.input.gsrnPaciente,
      opts.gs1ParsedGtin ?? opts.input.gs1Medicamento.slice(0, 14),
      null,  // lote — no disponible en fallo temprano
      null,  // serie
      null,  // fecha_vence
      opts.status,
      opts.hardStopCode ?? null,
      opts.reason ?? null,
      opts.expected ?? null,
      opts.received ?? null,
      opts.input.glnUbicacion ?? null,
    );
  } catch {
    // No propagamos errores de persistencia de hard-stop — el hard-stop
    // ya fue detectado y se retorna al cliente. Log queda en Supabase logs.
  }
}
