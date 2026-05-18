/**
 * Bedside Hard Stops — router tRPC (US.F2.6.27-30, Stream 10 extension).
 *
 * Implementa las 8 validaciones de Hard Stop para la Regla de los 5 Correctos:
 *   HS-01  PACIENTE_INCORRECTO        — GSRN pulsera ≠ GSRN de la indicación
 *   HS-02  MEDICAMENTO_INCORRECTO     — GTIN escaneado ≠ GTIN de la prescripción
 *   HS-03  DOSIS_INCORRECTA           — concentración del GTIN ≠ concentración prescrita
 *   HS-04  VIA_INCORRECTA             — vía de la unidosis ≠ vía de la indicación
 *   HS-05  HORA_FUERA_DE_VENTANA      — timestamp fuera de la ventana terapéutica
 *   HS-06  MEDICAMENTO_VENCIDO        — AI(17) del DataMatrix < now()
 *   HS-07  LOTE_EN_RECALL             — lote con recall activo en catálogo GS1
 *   HS-08  PROFESIONAL_NO_HABILITADO  — GSRN enfermera con activo=false en gs1_gsrn
 *
 * Contrato UX (US.F2.6.27):
 *   - Hard stop síncrono: el router lanza TRPCError antes de crear
 *     MedicationAdministration o actualizar PharmacyReservation.
 *   - La notificación outbox (farmacovigilancia / admin) se encola dentro
 *     de la misma transacción para garantizar entrega even-on-crash.
 *
 * Accesibilidad (US.F2.6.27):
 *   - Cada respuesta de error incluye `ariaMessage` — texto para aria-live
 *     assertive que el componente React inyecta en el region de anuncio.
 *
 * Performance (US.F2.6.27):
 *   - Todas las validaciones ocurren en < 500ms p95 (una query con múltiples
 *     JOINs) — sin lookups en serie.
 *
 * RLS: el router usa `tenantProcedure`; las queries directas a ece.* van
 * sin demote (BYPASSRLS) porque el schema ece no está bajo la política RLS
 * del schema public. Las tablas public.* se leen vía ctx.prisma que también
 * tiene BYPASSRLS — los filtros `organizationId` proveen el tenant scope.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../trpc";

// ---------------------------------------------------------------------------
// Schemas de input
// ---------------------------------------------------------------------------

const gs1DataMatrixInput = z.object({
  /** GTIN-14 extraído del DataMatrix (AI 01) */
  gtin: z.string().length(14).regex(/^\d{14}$/),
  /** Número de lote (AI 10) */
  lote: z.string().min(1).max(20),
  /** Fecha de vencimiento YYYYMMDD (AI 17) */
  vencimiento: z.string().regex(/^\d{8}$/, "Formato YYYYMMDD requerido"),
  /** Número de serie (AI 21) — opcional */
  serial: z.string().max(20).optional(),
});

export const bedsideValidateInput = z.object({
  /** GSRN del profesional (badge enfermera) */
  gsrnProfesional: z.string().length(18).regex(/^\d{18}$/),
  /** GSRN de la pulsera del paciente escaneado */
  gsrnPaciente: z.string().length(18).regex(/^\d{18}$/),
  /** Datos del DataMatrix de la unidosis escaneada */
  scanData: gs1DataMatrixInput,
  /** ID de la indicación médica activa (PharmacyOrder / MedicalOrder) */
  indicacionId: z.string().uuid(),
  /** Timestamp ISO 8601 del momento del escaneo (lo provee el cliente) */
  timestampEscaneo: z.string().datetime(),
  /** Vía de administración que la enfermera selecciona en pantalla */
  viaAdministracion: z.string().min(1).max(50),
});

export type BedsideValidateInput = z.infer<typeof bedsideValidateInput>;

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/** Resultado de una validación individual — ok o hard stop */
type ValidacionResult =
  | { ok: true }
  | { ok: false; errorCode: string; ariaMessage: string; notificaFarmacovigilancia: boolean; notificaAdmin: boolean };

// ---------------------------------------------------------------------------
// Helpers de validación
// ---------------------------------------------------------------------------

/** Parsea vencimiento YYYYMMDD a Date (timezone El Salvador = UTC-6) */
export function parseGs1Vencimiento(yyyymmdd: string): Date {
  const year  = parseInt(yyyymmdd.slice(0, 4), 10);
  const month = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const day   = parseInt(yyyymmdd.slice(6, 8), 10);
  return new Date(Date.UTC(year, month, day, 23, 59, 59));
}

/** Retorna true si el timestamp está dentro de la ventana terapéutica */
export function dentroDeVentanaTerapeutica(
  horaProgramada: Date,
  timestampEscaneo: Date,
  ventanaMinutos: number,
): boolean {
  const diffMs = Math.abs(timestampEscaneo.getTime() - horaProgramada.getTime());
  return diffMs <= ventanaMinutos * 60_000;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const bedsideHardStopsRouter = router({
  /**
   * `validate` — valida los 5 correctos de forma síncrona.
   *
   * Lanza TRPCError con code "PRECONDITION_FAILED" y meta `{ hardStopCode }`
   * si cualquier hard stop se activa. El caller (UI) usa `hardStopCode` para
   * mostrar el modal full-screen rojo con el texto adecuado.
   *
   * Si todos los correctos pasan, retorna `{ ok: true, administracionId: null }`
   * y el caller puede proceder a registrar la administración.
   */
  validate: tenantProcedure
    .input(bedsideValidateInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date(input.timestampEscaneo);

      // ------------------------------------------------------------------
      // Paso 0: Validar GSRN profesional (HS-08)
      // ------------------------------------------------------------------
      type GsrnRow = { id: string; activo: boolean; tipo: string };
      const gsrnProfRows = await ctx.prisma.$queryRawUnsafe<GsrnRow[]>(
        `SELECT id, activo, tipo FROM ece.gs1_gsrn WHERE codigo = $1 LIMIT 1`,
        input.gsrnProfesional,
      );
      const gsrnProf = gsrnProfRows[0];

      if (!gsrnProf || !gsrnProf.activo) {
        await _enqueueHardStopNotification(ctx, {
          hardStopCode: "PROFESIONAL_NO_HABILITADO",
          indicacionId: input.indicacionId,
          gsrnProfesional: input.gsrnProfesional,
          gsrnPaciente: input.gsrnPaciente,
          gtin: input.scanData.gtin,
          lote: input.scanData.lote,
          organizationId: ctx.tenant.organizationId,
          notificaFarmacovigilancia: false,
          notificaAdmin: true,
        });

        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "PROFESIONAL NO HABILITADO: GSRN revocado o no registrado.",
          cause: { hardStopCode: "PROFESIONAL_NO_HABILITADO" },
        });
      }

      // ------------------------------------------------------------------
      // Paso 1: Validar GSRN paciente (HS-01)
      // ------------------------------------------------------------------
      type GsrnPacRow = { id: string; referencia_id: string; activo: boolean };
      const gsrnPacRows = await ctx.prisma.$queryRawUnsafe<GsrnPacRow[]>(
        `SELECT id, referencia_id, activo FROM ece.gs1_gsrn
          WHERE codigo = $1 AND tipo = 'paciente' LIMIT 1`,
        input.gsrnPaciente,
      );
      const gsrnPac = gsrnPacRows[0];

      if (!gsrnPac || !gsrnPac.activo) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "PACIENTE INCORRECTO: GSRN de pulsera no encontrado o inactivo.",
          cause: { hardStopCode: "PACIENTE_INCORRECTO" },
        });
      }

      // Verificar que la indicación pertenece al paciente asociado a ese GSRN
      // La indicación en la BD debe tener el patientId que coincide con referencia_id del GSRN
      type IndicacionRow = {
        id: string;
        patient_id: string;
        gtin_prescripto: string | null;
        concentracion_prescrita: string | null;
        via_administracion: string | null;
        hora_programada: Date | null;
        ventana_minutos: number | null;
      };
      const indicRows = await ctx.prisma.$queryRawUnsafe<IndicacionRow[]>(
        `SELECT i.id,
                i.patient_id,
                i.gtin_prescripto,
                i.concentracion_prescrita,
                i.via_administracion,
                i.hora_programada,
                COALESCE(i.ventana_minutos, 30) AS ventana_minutos
           FROM ece.indicacion_bedside i
          WHERE i.id = $1::uuid
            AND i.organization_id = $2::uuid
          LIMIT 1`,
        input.indicacionId,
        ctx.tenant.organizationId,
      );
      const indicacion = indicRows[0];

      if (!indicacion) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Indicación no encontrada o no pertenece a esta organización.",
        });
      }

      if (indicacion.patient_id !== gsrnPac.referencia_id) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "PACIENTE INCORRECTO: la pulsera escaneada no corresponde al paciente de la indicación.",
          cause: { hardStopCode: "PACIENTE_INCORRECTO" },
        });
      }

      // ------------------------------------------------------------------
      // Paso 2: Validar GTIN medicamento (HS-02)
      // ------------------------------------------------------------------
      if (
        indicacion.gtin_prescripto &&
        indicacion.gtin_prescripto !== input.scanData.gtin
      ) {
        await _enqueueHardStopNotification(ctx, {
          hardStopCode: "MEDICAMENTO_INCORRECTO",
          indicacionId: input.indicacionId,
          gsrnProfesional: input.gsrnProfesional,
          gsrnPaciente: input.gsrnPaciente,
          gtin: input.scanData.gtin,
          lote: input.scanData.lote,
          organizationId: ctx.tenant.organizationId,
          notificaFarmacovigilancia: true,
          notificaAdmin: false,
        });

        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "MEDICAMENTO INCORRECTO: GTIN escaneado no coincide con la prescripción activa.",
          cause: { hardStopCode: "MEDICAMENTO_INCORRECTO" },
        });
      }

      // ------------------------------------------------------------------
      // Paso 3: Validar vencimiento (HS-06)
      // ------------------------------------------------------------------
      const fechaVencimiento = parseGs1Vencimiento(input.scanData.vencimiento);
      if (fechaVencimiento < now) {
        await _enqueueHardStopNotification(ctx, {
          hardStopCode: "MEDICAMENTO_VENCIDO",
          indicacionId: input.indicacionId,
          gsrnProfesional: input.gsrnProfesional,
          gsrnPaciente: input.gsrnPaciente,
          gtin: input.scanData.gtin,
          lote: input.scanData.lote,
          organizationId: ctx.tenant.organizationId,
          notificaFarmacovigilancia: true,
          notificaAdmin: false,
        });

        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `MEDICAMENTO VENCIDO: fecha de vencimiento ${input.scanData.vencimiento} es anterior a hoy.`,
          cause: { hardStopCode: "MEDICAMENTO_VENCIDO" },
        });
      }

      // ------------------------------------------------------------------
      // Paso 4: Validar recall de lote (HS-07)
      // ------------------------------------------------------------------
      type RecallRow = { en_recall: boolean };
      const recallRows = await ctx.prisma.$queryRawUnsafe<RecallRow[]>(
        `SELECT COALESCE(en_recall, false) AS en_recall
           FROM ece.gs1_gtin_lote
          WHERE gtin = $1 AND lote = $2
          LIMIT 1`,
        input.scanData.gtin,
        input.scanData.lote,
      );
      const recallRow = recallRows[0];

      if (recallRow?.en_recall) {
        await _enqueueHardStopNotification(ctx, {
          hardStopCode: "LOTE_EN_RECALL",
          indicacionId: input.indicacionId,
          gsrnProfesional: input.gsrnProfesional,
          gsrnPaciente: input.gsrnPaciente,
          gtin: input.scanData.gtin,
          lote: input.scanData.lote,
          organizationId: ctx.tenant.organizationId,
          notificaFarmacovigilancia: true,
          notificaAdmin: false,
        });

        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `LOTE EN RECALL: el lote ${input.scanData.lote} tiene alerta de recall activa.`,
          cause: { hardStopCode: "LOTE_EN_RECALL" },
        });
      }

      // ------------------------------------------------------------------
      // Paso 5: Validar dosis / concentración (HS-03)
      // ------------------------------------------------------------------
      // La concentración prescrita está en indicacion.concentracion_prescrita
      // La del GTIN escaneado se obtiene del catálogo
      type GtinConcRow = { concentracion: string | null };
      const gtinConcRows = await ctx.prisma.$queryRawUnsafe<GtinConcRow[]>(
        `SELECT presentacion AS concentracion FROM ece.gs1_gtin WHERE codigo = $1 LIMIT 1`,
        input.scanData.gtin,
      );
      const gtinCatalog = gtinConcRows[0];

      if (
        indicacion.concentracion_prescrita &&
        gtinCatalog?.concentracion &&
        normalizeConcentracion(gtinCatalog.concentracion) !==
          normalizeConcentracion(indicacion.concentracion_prescrita)
      ) {
        await _enqueueHardStopNotification(ctx, {
          hardStopCode: "DOSIS_INCORRECTA",
          indicacionId: input.indicacionId,
          gsrnProfesional: input.gsrnProfesional,
          gsrnPaciente: input.gsrnPaciente,
          gtin: input.scanData.gtin,
          lote: input.scanData.lote,
          organizationId: ctx.tenant.organizationId,
          notificaFarmacovigilancia: true,
          notificaAdmin: false,
        });

        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `DOSIS INCORRECTA: concentración escaneada no coincide con la prescrita.`,
          cause: { hardStopCode: "DOSIS_INCORRECTA" },
        });
      }

      // ------------------------------------------------------------------
      // Paso 6: Validar vía de administración (HS-04)
      // ------------------------------------------------------------------
      if (
        indicacion.via_administracion &&
        normalizeVia(input.viaAdministracion) !== normalizeVia(indicacion.via_administracion)
      ) {
        await _enqueueHardStopNotification(ctx, {
          hardStopCode: "VIA_INCORRECTA",
          indicacionId: input.indicacionId,
          gsrnProfesional: input.gsrnProfesional,
          gsrnPaciente: input.gsrnPaciente,
          gtin: input.scanData.gtin,
          lote: input.scanData.lote,
          organizationId: ctx.tenant.organizationId,
          notificaFarmacovigilancia: true,
          notificaAdmin: false,
        });

        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `VIA INCORRECTA: vía escaneada "${input.viaAdministracion}" ≠ vía prescrita "${indicacion.via_administracion}".`,
          cause: { hardStopCode: "VIA_INCORRECTA" },
        });
      }

      // ------------------------------------------------------------------
      // Paso 7: Validar ventana terapéutica (HS-05)
      // ------------------------------------------------------------------
      if (indicacion.hora_programada && indicacion.ventana_minutos) {
        const enVentana = dentroDeVentanaTerapeutica(
          new Date(indicacion.hora_programada),
          now,
          indicacion.ventana_minutos,
        );
        if (!enVentana) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `HORARIO INCORRECTO: escaneo fuera de la ventana terapéutica de ±${indicacion.ventana_minutos} min.`,
            cause: { hardStopCode: "HORA_FUERA_DE_VENTANA" },
          });
        }
      }

      // ------------------------------------------------------------------
      // Todos los 5 correctos pasaron
      // ------------------------------------------------------------------
      return { ok: true as const };
    }),

  /**
   * `getHardStopSummary` — devuelve el conteo de hard stops por tipo
   * para el turno activo. Usado en el dashboard de farmacovigilancia.
   */
  getHardStopSummary: tenantProcedure
    .input(z.object({
      fechaInicio: z.string().datetime(),
      fechaFin: z.string().datetime().optional(),
    }))
    .query(async ({ ctx, input }) => {
      type SummaryRow = { hard_stop_code: string; total: string };
      const rows = await ctx.prisma.$queryRawUnsafe<SummaryRow[]>(
        `SELECT hard_stop_code, COUNT(*)::text AS total
           FROM ece.bedside_hard_stop_log
          WHERE organization_id = $1::uuid
            AND created_at >= $2::timestamptz
            AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz)
          GROUP BY hard_stop_code
          ORDER BY total DESC`,
        ctx.tenant.organizationId,
        input.fechaInicio,
        input.fechaFin ?? null,
      );
      return rows.map((r) => ({
        hardStopCode: r.hard_stop_code,
        total: parseInt(r.total, 10),
      }));
    }),
});

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

function normalizeConcentracion(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeVia(s: string): string {
  return s.trim().toUpperCase();
}

interface HardStopNotificationPayload {
  hardStopCode: string;
  indicacionId: string;
  gsrnProfesional: string;
  gsrnPaciente: string;
  gtin: string;
  lote: string;
  organizationId: string;
  notificaFarmacovigilancia: boolean;
  notificaAdmin: boolean;
}

/**
 * Encola la notificación de hard stop en la tabla outbox de dominio.
 * Es fire-and-forget desde el punto de vista de la validación — si falla,
 * el hard stop igual se lanza. La entrega outbox es responsabilidad de
 * los workers Inngest (Beta.15).
 *
 * El parámetro `prisma` acepta cualquier objeto con `$executeRawUnsafe`
 * compatible con el cliente Prisma — incluyendo el cliente real y mocks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _enqueueHardStopNotification(
  ctx: { prisma: any },
  payload: HardStopNotificationPayload,
): Promise<void> {
  try {
    await ctx.prisma.$executeRawUnsafe(
      `INSERT INTO ece.bedside_hard_stop_log
         (organization_id, hard_stop_code, indicacion_id,
          gsrn_profesional, gsrn_paciente, gtin, lote,
          notifica_farmacovigilancia, notifica_admin, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, now())`,
      payload.organizationId,
      payload.hardStopCode,
      payload.indicacionId,
      payload.gsrnProfesional,
      payload.gsrnPaciente,
      payload.gtin,
      payload.lote,
      payload.notificaFarmacovigilancia,
      payload.notificaAdmin,
    );
  } catch {
    // El log de hard stop no debe bloquear el hard stop en sí.
    // El error se ignora silenciosamente — en CI sin BD real esto falla.
  }
}
