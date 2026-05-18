/**
 * Router tRPC — Comité del Expediente Clínico (ECE) + Calidad Documental.
 *
 * Norma: Art. 32 NTEC (MINSAL Acuerdo n.° 1616, 2024).
 * US.F2.7.46 — Minutas auditables con hash chain.
 * US.F2.7.47 — Dashboard KPIs calidad documental.
 * US.F2.7.48 — Reporte auditoría institucional (export).
 *
 * ─── Tablas BD ────────────────────────────────────────────────────────────────
 *   ece.comite_minuta               — minutas (inmutables post-firma)
 *   ece.v_calidad_documental        — vista materializada KPIs (refresh horario)
 *
 * ─── Hash chain ───────────────────────────────────────────────────────────────
 *   Al firmar una minuta se calcula:
 *     payload_hash  = SHA-256(JSON.stringify({asistentes, temasAgenda, acuerdos}))
 *     prev_hash     = chain_hash de la minuta firmada más reciente del tenant
 *     chain_hash    = SHA-256(prev_hash || payload_hash)
 *   Patrón idéntico a audit_log (05_audit_hash_chain.sql).
 *
 * ─── Roles tRPC ───────────────────────────────────────────────────────────────
 *   list          → requireRole(["DIR","ARCH","ADMIN"])
 *   get           → requireRole(["DIR","ARCH","ADMIN"])
 *   create        → requireRole(["DIR","ADMIN"])
 *   update        → requireRole(["DIR","ADMIN"])   — solo mientras borrador
 *   firmar        → requireRole(["DIR"])           — inmutable post-firma
 *   dashboard     → requireRole(["DIR","ARCH","ADMIN"])
 *   exportReport  → requireRole(["DIR"])
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, requireRole } from "../../trpc";
import { withTenantContext } from "../../rls-context";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const asistenteSchema = z.object({
  nombre: z.string().min(1).max(200),
  rol: z.string().min(1).max(80),
  personalId: z.string().uuid().optional(),
});

const temaSchema = z.object({
  numero: z.number().int().min(1),
  tema: z.string().min(1).max(300),
  descripcion: z.string().max(2000).optional(),
});

const acuerdoSchema = z.object({
  numero: z.number().int().min(1),
  acuerdo: z.string().min(1).max(2000),
  responsable: z.string().max(200).optional(),
  fechaLimite: z.string().date().optional(), // ISO date string
});

const createInputSchema = z.object({
  fechaReunion: z.coerce.date(),
  establecimientoId: z.string().uuid().optional(),
  asistentes: z.array(asistenteSchema).min(1, "Se requiere al menos un asistente"),
  temasAgenda: z.array(temaSchema).min(1, "Se requiere al menos un tema"),
  acuerdos: z.array(acuerdoSchema).default([]),
  proximaFecha: z.coerce.date().optional(),
});

const updateInputSchema = z.object({
  id: z.string().uuid(),
  asistentes: z.array(asistenteSchema).min(1).optional(),
  temasAgenda: z.array(temaSchema).min(1).optional(),
  acuerdos: z.array(acuerdoSchema).optional(),
  proximaFecha: z.coerce.date().optional(),
});

const firmarInputSchema = z.object({
  id: z.string().uuid(),
  firmaPresidenteId: z.string().uuid(),
});

const listInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  estado: z.enum(["borrador", "firmada"]).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

const reportInputSchema = z.object({
  periodoInicio: z.coerce.date(),
  periodoFin: z.coerce.date(),
  tipo: z.enum(["MINSAL", "ISSS", "INTERNO"]).default("INTERNO"),
});

// ---------------------------------------------------------------------------
// Tipos raw BD
// ---------------------------------------------------------------------------

export interface ComiteMinutaRow {
  id: string;
  organization_id: string;
  establecimiento_id: string | null;
  fecha_reunion: Date;
  asistentes: unknown;
  temas_agenda: unknown;
  acuerdos: unknown;
  proxima_fecha: Date | null;
  firma_presidente_id: string | null;
  firmada_en: Date | null;
  estado: string;
  payload_hash: string | null;
  prev_hash: string | null;
  chain_hash: string | null;
  registrado_por: string | null;
  registrado_en: Date;
  actualizado_en: Date;
}

interface CalidadKpiRow {
  establecimiento_id: string;
  total_episodios_cerrados: bigint;
  total_con_epicrisis: bigint;
  total_con_cie10: bigint;
  pct_cobertura_cie10: string | null;
  promedio_horas_hasta_egreso: string | null;
  total_rectificaciones_mes: bigint;
  calculado_en: Date;
}

// ---------------------------------------------------------------------------
// Hash chain helpers
// ---------------------------------------------------------------------------

function buildPayloadHash(data: {
  asistentes: unknown;
  temasAgenda: unknown;
  acuerdos: unknown;
}): string {
  const canonical = JSON.stringify(data, null, 0);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function buildChainHash(prevHash: string, payloadHash: string): string {
  return createHash("sha256").update(prevHash + payloadHash, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Base procedure — roles mínimos Comité ECE
// ---------------------------------------------------------------------------

const comiteBase = requireRole(["DIR", "ARCH", "ADMIN"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const comiteEceRouter = router({
  /**
   * Lista minutas del comité filtradas por estado y período.
   */
  list: comiteBase.input(listInputSchema).query(async ({ ctx, input }) => {
    const offset = (input.page - 1) * input.pageSize;
    const estadoFilter = input.estado ?? null;
    const desdeFilter = input.desde ?? null;
    const hastaFilter = input.hasta ?? null;

    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const rows = await tx.$queryRaw<ComiteMinutaRow[]>`
        SELECT id::text, organization_id::text, establecimiento_id::text,
               fecha_reunion, asistentes, temas_agenda, acuerdos,
               proxima_fecha, firma_presidente_id::text, firmada_en,
               estado, payload_hash, prev_hash, chain_hash,
               registrado_por::text, registrado_en, actualizado_en
        FROM ece.comite_minuta
        WHERE organization_id = ${ctx.tenant.organizationId}::uuid
          AND (${estadoFilter}::text IS NULL OR estado = ${estadoFilter}::text)
          AND (${desdeFilter}::timestamptz IS NULL OR fecha_reunion >= ${desdeFilter}::timestamptz)
          AND (${hastaFilter}::timestamptz IS NULL OR fecha_reunion <= ${hastaFilter}::timestamptz)
        ORDER BY fecha_reunion DESC
        LIMIT ${input.pageSize} OFFSET ${offset}
      `;

      const [{ total }] = await tx.$queryRaw<[{ total: bigint }]>`
        SELECT COUNT(*) AS total
        FROM ece.comite_minuta
        WHERE organization_id = ${ctx.tenant.organizationId}::uuid
          AND (${estadoFilter}::text IS NULL OR estado = ${estadoFilter}::text)
      `;

      return {
        items: rows,
        total: Number(total),
        page: input.page,
        pageSize: input.pageSize,
      };
    });
  }),

  /**
   * Lectura de una minuta por ID.
   */
  get: comiteBase.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const rows = await tx.$queryRaw<ComiteMinutaRow[]>`
        SELECT id::text, organization_id::text, establecimiento_id::text,
               fecha_reunion, asistentes, temas_agenda, acuerdos,
               proxima_fecha, firma_presidente_id::text, firmada_en,
               estado, payload_hash, prev_hash, chain_hash,
               registrado_por::text, registrado_en, actualizado_en
        FROM ece.comite_minuta
        WHERE id = ${input.id}::uuid
          AND organization_id = ${ctx.tenant.organizationId}::uuid
        LIMIT 1
      `;

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Minuta no encontrada." });
      }

      return rows[0]!;
    });
  }),

  /**
   * Crea una nueva minuta en estado 'borrador'.
   */
  create: requireRole(["DIR", "ADMIN"]).input(createInputSchema).mutation(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const establecimientoId = input.establecimientoId ?? null;
      const proximaFecha = input.proximaFecha ?? null;

      const rows = await tx.$queryRaw<[{ id: string }]>`
        INSERT INTO ece.comite_minuta
          (organization_id, establecimiento_id, fecha_reunion,
           asistentes, temas_agenda, acuerdos, proxima_fecha,
           estado, registrado_por)
        VALUES
          (${ctx.tenant.organizationId}::uuid,
           ${establecimientoId}::uuid,
           ${input.fechaReunion}::date,
           ${JSON.stringify(input.asistentes)}::jsonb,
           ${JSON.stringify(input.temasAgenda)}::jsonb,
           ${JSON.stringify(input.acuerdos)}::jsonb,
           ${proximaFecha}::date,
           'borrador',
           ${ctx.user.id}::uuid)
        RETURNING id::text
      `;

      return { id: rows[0]!.id };
    });
  }),

  /**
   * Actualiza una minuta en estado 'borrador'.
   * Después de firmada, el trigger en BD bloquea cualquier modificación.
   */
  update: requireRole(["DIR", "ADMIN"]).input(updateInputSchema).mutation(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const row = await tx.$queryRaw<[{ estado: string }?]>`
        SELECT estado FROM ece.comite_minuta
        WHERE id = ${input.id}::uuid
          AND organization_id = ${ctx.tenant.organizationId}::uuid
        LIMIT 1
      `;

      if (!row[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Minuta no encontrada." });
      }
      if (row[0].estado === "firmada") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "La minuta ya fue firmada y no puede modificarse.",
        });
      }

      const asistentesJson = input.asistentes ? JSON.stringify(input.asistentes) : null;
      const temasJson = input.temasAgenda ? JSON.stringify(input.temasAgenda) : null;
      const acuerdosJson = input.acuerdos ? JSON.stringify(input.acuerdos) : null;
      const proximaFecha = input.proximaFecha ?? null;

      await tx.$executeRaw`
        UPDATE ece.comite_minuta
        SET
          asistentes    = COALESCE(${asistentesJson}::jsonb, asistentes),
          temas_agenda  = COALESCE(${temasJson}::jsonb, temas_agenda),
          acuerdos      = COALESCE(${acuerdosJson}::jsonb, acuerdos),
          proxima_fecha = COALESCE(${proximaFecha}::date, proxima_fecha),
          actualizado_en = now()
        WHERE id = ${input.id}::uuid
          AND organization_id = ${ctx.tenant.organizationId}::uuid
          AND estado = 'borrador'
      `;

      return { ok: true as const };
    });
  }),

  /**
   * Firma la minuta (DIR). Transición borrador → firmada.
   * Calcula hash chain (patrón audit_log): payload_hash, prev_hash, chain_hash.
   * Post-firma: inmutable por trigger en BD.
   */
  firmar: requireRole(["DIR"]).input(firmarInputSchema).mutation(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      // 1. Verificar estado actual
      const minutaRows = await tx.$queryRaw<ComiteMinutaRow[]>`
        SELECT id::text, organization_id::text, asistentes, temas_agenda, acuerdos, estado
        FROM ece.comite_minuta
        WHERE id = ${input.id}::uuid
          AND organization_id = ${ctx.tenant.organizationId}::uuid
        LIMIT 1
      `;

      const minuta = minutaRows[0];
      if (!minuta) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Minuta no encontrada." });
      }
      if (minuta.estado !== "borrador") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se puede firmar una minuta en estado borrador. Estado actual: ${minuta.estado}.`,
        });
      }

      // 2. Calcular hashes
      const payloadHash = buildPayloadHash({
        asistentes: minuta.asistentes,
        temasAgenda: minuta.temas_agenda,
        acuerdos: minuta.acuerdos,
      });

      // Obtener el chain_hash de la última minuta firmada del tenant
      const prevRows = await tx.$queryRaw<[{ chain_hash: string | null }?]>`
        SELECT chain_hash
        FROM ece.comite_minuta
        WHERE organization_id = ${ctx.tenant.organizationId}::uuid
          AND estado = 'firmada'
        ORDER BY firmada_en DESC
        LIMIT 1
      `;
      const prevHash = prevRows[0]?.chain_hash ?? "0".repeat(64);
      const chainHash = buildChainHash(prevHash, payloadHash);

      // 3. Actualizar (trigger inmutable se activa si ya estuviera firmada — doble protección)
      await tx.$executeRaw`
        UPDATE ece.comite_minuta
        SET
          estado               = 'firmada',
          firma_presidente_id  = ${input.firmaPresidenteId}::uuid,
          firmada_en           = now(),
          payload_hash         = ${payloadHash},
          prev_hash            = ${prevHash},
          chain_hash           = ${chainHash},
          actualizado_en       = now()
        WHERE id = ${input.id}::uuid
          AND organization_id  = ${ctx.tenant.organizationId}::uuid
          AND estado           = 'borrador'
      `;

      return { ok: true as const, payloadHash, chainHash };
    });
  }),

  /**
   * Dashboard KPIs de calidad documental.
   * Lee la vista materializada ece.v_calidad_documental.
   * La vista se refresca con un cron horario (configurar en Supabase Dashboard).
   */
  dashboard: comiteBase.query(async ({ ctx }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const rows = await tx.$queryRaw<CalidadKpiRow[]>`
        SELECT
          establecimiento_id::text,
          total_episodios_cerrados,
          total_con_epicrisis,
          total_con_cie10,
          pct_cobertura_cie10,
          promedio_horas_hasta_egreso,
          total_rectificaciones_mes,
          calculado_en
        FROM ece.v_calidad_documental
      `;

      if (rows.length === 0) {
        return {
          kpis: [],
          mensaje: "Sin datos en el período de 90 días. La vista se actualiza cada hora.",
        };
      }

      return {
        kpis: rows.map((r) => ({
          establecimientoId: r.establecimiento_id,
          totalEpisodiosCerrados: Number(r.total_episodios_cerrados),
          totalConEpicrisis: Number(r.total_con_epicrisis),
          totalConCie10: Number(r.total_con_cie10),
          pctCoberturaCie10: r.pct_cobertura_cie10 ? parseFloat(r.pct_cobertura_cie10) : null,
          promedioHorasHastaEgreso: r.promedio_horas_hasta_egreso
            ? parseFloat(r.promedio_horas_hasta_egreso)
            : null,
          totalRectificacionesMes: Number(r.total_rectificaciones_mes),
          calculadoEn: r.calculado_en,
        })),
        mensaje: null,
      };
    });
  }),

  /**
   * Genera un resumen de auditoría de calidad para exportación (MINSAL/ISSS).
   * Retorna los datos estructurados; el PDF lo renderiza la UI (react-pdf / html→pdf).
   */
  exportReport: requireRole(["DIR"]).input(reportInputSchema).query(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      // Minutas del período
      const minutas = await tx.$queryRaw<
        Array<{ id: string; fecha_reunion: Date; estado: string; asistentes: unknown; acuerdos: unknown }>
      >`
        SELECT id::text, fecha_reunion, estado, asistentes, acuerdos
        FROM ece.comite_minuta
        WHERE organization_id = ${ctx.tenant.organizationId}::uuid
          AND fecha_reunion BETWEEN ${input.periodoInicio}::date AND ${input.periodoFin}::date
        ORDER BY fecha_reunion ASC
      `;

      // KPIs del período (directo de la vista — no filtra por fecha pero es orientativo)
      const kpiRows = await tx.$queryRaw<CalidadKpiRow[]>`
        SELECT * FROM ece.v_calidad_documental
      `;

      // Total de episodios en el período
      const [periodoStats] = await tx.$queryRaw<
        [{ total_episodios: bigint; total_cerrados: bigint; total_con_cie10: bigint }]
      >`
        SELECT
          COUNT(*) AS total_episodios,
          COUNT(*) FILTER (WHERE ea.fecha_hora_cierre IS NOT NULL) AS total_cerrados,
          COUNT(ee.cie10_principal) AS total_con_cie10
        FROM ece.episodio_atencion ea
        JOIN ece.episodio_hospitalario eh ON eh.episodio_id = ea.id
        LEFT JOIN ece.epicrisis_egreso ee ON ee.episodio_id = ea.id
        WHERE ea.fecha_hora_inicio >= ${input.periodoInicio}::timestamptz
          AND ea.fecha_hora_inicio <= ${input.periodoFin}::timestamptz
      `;

      return {
        tipo: input.tipo,
        periodoInicio: input.periodoInicio,
        periodoFin: input.periodoFin,
        generadoEn: new Date(),
        generadoPorId: ctx.user.id,
        minutas,
        kpis: kpiRows.map((r) => ({
          establecimientoId: r.establecimiento_id,
          totalEpisodiosCerrados: Number(r.total_episodios_cerrados),
          totalConEpicrisis: Number(r.total_con_epicrisis),
          totalConCie10: Number(r.total_con_cie10),
          pctCoberturaCie10: r.pct_cobertura_cie10 ? parseFloat(r.pct_cobertura_cie10) : null,
          totalRectificacionesMes: Number(r.total_rectificaciones_mes),
          calculadoEn: r.calculado_en,
        })),
        periodoStats: {
          totalEpisodios: Number(periodoStats?.total_episodios ?? 0),
          totalCerrados: Number(periodoStats?.total_cerrados ?? 0),
          totalConCie10: Number(periodoStats?.total_con_cie10 ?? 0),
          pctCie10:
            periodoStats && Number(periodoStats.total_cerrados) > 0
              ? Math.round(
                  (Number(periodoStats.total_con_cie10) / Number(periodoStats.total_cerrados)) *
                    100 *
                    100,
                ) / 100
              : 0,
        },
      };
    });
  }),
});
