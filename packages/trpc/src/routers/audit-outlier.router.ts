/**
 * F2-S15 Stream D — Router tRPC: Audit Outlier Detection.
 *
 * US.F2.7.13 — Alerta acceso fuera de horario o IP inusual.
 * US.F2.7.16 — Dashboard auditoría accesos para DIR.
 *
 * Escanea ece.bitacora_acceso buscando accesos entre 22:00-06:00
 * o desde IPs no whitelisted y marca flag_outlier=true.
 *
 * Procedures:
 *   auditOutlier.listOutliers    — lista accesos marcados como outlier (DIR/ARCH).
 *   auditOutlier.flagOutlier     — marca manualmente un acceso como outlier (DIR).
 *   auditOutlier.scanAndFlag     — job: escanea y marca outliers automáticamente (DIR).
 *   auditOutlier.dashboardStats  — estadísticas para dashboard DIR (US.F2.7.16).
 *   auditOutlier.topUsers        — top 10 usuarios por accesos último mes (DIR).
 *   auditOutlier.sensitiveAccess — accesos a expedientes sensibles VIP/mental/HIV (DIR).
 *   auditOutlier.getConfig       — lee AuditDashboardConfig de la org.
 *   auditOutlier.upsertConfig    — crea/actualiza config (DIR).
 *
 * Tablas:
 *   ece.bitacora_acceso        — columnas flag_outlier, motivo_outlier (migración 02)
 *   public."AuditDashboardConfig" — whitelist IP + horario (migración 03)
 *
 * NO modifica _app.ts — se registra por @Orq.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { requireRole, router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listOutliersInput = z.object({
  desde:  z.string().datetime().optional(),
  hasta:  z.string().datetime().optional(),
  limit:  z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const flagOutlierInput = z.object({
  // `ece.bitacora_acceso.id` es BIGINT GENERATED ALWAYS AS IDENTITY (no UUID).
  // Acepta string o number desde el cliente (query params suelen llegar como string)
  // y coerciona a number entero positivo seguro hasta 2^53.
  bitacoraId: z.coerce.number().int().positive(),
  motivo:     z.string().min(1).max(200),
});

const scanAndFlagInput = z.object({
  // Rango a escanear. Sin especificar: últimas 24h.
  desde: z.string().datetime().optional(),
  hasta: z.string().datetime().optional(),
});

const dashboardStatsInput = z.object({
  desde: z.string().datetime().optional(),
  hasta: z.string().datetime().optional(),
});

const upsertConfigInput = z.object({
  ipWhitelist:          z.array(z.string().max(45)).default([]),
  horarioClinicoInicio: z.string().regex(/^\d{2}:\d{2}$/).default("06:00"),
  horarioClinicoFin:    z.string().regex(/^\d{2}:\d{2}$/).default("22:00"),
  outlierAlertEnabled:  z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Fragmento SQL reutilizable: JOIN para aislar registros por organización.
//
// ece.bitacora_acceso no tiene organization_id directamente; la cadena es:
//   bitacora_acceso.establecimiento_id → ece.establecimiento.institucion_id
//   → ece.institucion.organization_id (FK nullable a public."Organization")
//
// El filtro explícito es defensa en profundidad sobre el rol Postgres que
// ejecuta la query (BYPASSRLS cuando no se usa withTenantContext).
// ---------------------------------------------------------------------------
const ORG_JOIN = `
  JOIN ece.establecimiento est ON b.establecimiento_id = est.id
  JOIN ece.institucion     i   ON est.institucion_id   = i.id
`;

// ---------------------------------------------------------------------------
// Tipos raw SQL
// ---------------------------------------------------------------------------

type OutlierRow = {
  id:             string;
  personal_id:    string | null;
  auth_user_id:   string | null;
  accion:         string;
  autorizado:     boolean;
  ip_origen:      string | null;
  ocurrido_en:    Date;
  flag_outlier:   boolean;
  motivo_outlier: string | null;
  recurso_id:     string | null;
};

type ConfigRow = {
  id:                      string;
  organizationId:          string;
  ipWhitelist:             string[];
  horarioClinicoInicio:    string;
  horarioClinicoFin:       string;
  outlierAlertEnabled:     boolean;
};

type CountRow   = { total: bigint };
type BigintRow  = { count: bigint };
type UserRow    = { auth_user_id: string; count: bigint };

// ---------------------------------------------------------------------------
// Helper: leer config de la org
// ---------------------------------------------------------------------------

async function getOrgConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  orgId: string,
): Promise<ConfigRow | null> {
  const rows = await (prisma.$queryRawUnsafe as (
    sql: string,
    ...params: unknown[]
  ) => Promise<ConfigRow[]>)(
    `SELECT id, "organizationId", "ipWhitelist", "horarioClinicoInicio",
            "horarioClinicoFin", "outlierAlertEnabled"
     FROM public."AuditDashboardConfig"
     WHERE "organizationId" = $1::uuid
     LIMIT 1`,
    orgId,
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const auditOutlierRouter = router({
  /**
   * Lista accesos marcados como outlier con paginación.
   */
  listOutliers: requireRole(["DIR", "ARCH"])
    .input(listOutliersInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const conditions: string[] = ["b.flag_outlier = true", `i.organization_id = $1::uuid`];
      const params: unknown[] = [orgId];
      let idx = 2;

      if (input.desde) {
        conditions.push(`b.ocurrido_en >= $${idx++}::timestamptz`);
        params.push(input.desde);
      }
      if (input.hasta) {
        conditions.push(`b.ocurrido_en <= $${idx++}::timestamptz`);
        params.push(input.hasta);
      }
      const where = conditions.join(" AND ");

      const countRows = await ctx.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS total FROM ece.bitacora_acceso b ${ORG_JOIN} WHERE ${where}`,
        ...params,
      );
      const total = Number(countRows[0]?.total ?? 0);

      const dataParams = [...params, input.limit, input.offset];
      const lIdx = params.length + 1;
      const oIdx = params.length + 2;

      const rows = await ctx.prisma.$queryRawUnsafe<OutlierRow[]>(
        `SELECT b.id, b.personal_id, b.auth_user_id, b.accion, b.autorizado,
                b.ip_origen, b.ocurrido_en, b.flag_outlier, b.motivo_outlier, b.recurso_id
         FROM ece.bitacora_acceso b ${ORG_JOIN}
         WHERE ${where}
         ORDER BY b.ocurrido_en DESC
         LIMIT $${lIdx} OFFSET $${oIdx}`,
        ...dataParams,
      );

      return {
        items: rows.map((r) => ({
          id:            r.id,
          personalId:    r.personal_id,
          authUserId:    r.auth_user_id,
          accion:        r.accion,
          autorizado:    r.autorizado,
          ipOrigen:      r.ip_origen,
          ocurridoEn:    r.ocurrido_en.toISOString(),
          flagOutlier:   r.flag_outlier,
          motivoOutlier: r.motivo_outlier,
          recursoId:     r.recurso_id,
        })),
        total,
      };
    }),

  /**
   * Marca manualmente un acceso como outlier con motivo.
   */
  flagOutlier: requireRole(["DIR"])
    .input(flagOutlierInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      // El WHERE incluye el JOIN implícito via subquery para garantizar
      // que el registro pertenece a la organización del caller.
      const affected = await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.bitacora_acceso b
         SET flag_outlier = true, motivo_outlier = $1
         FROM ece.establecimiento est
         JOIN ece.institucion i ON est.institucion_id = i.id
         WHERE b.establecimiento_id = est.id
           AND i.organization_id = $2::uuid
           AND b.id = $3::bigint`,
        input.motivo,
        orgId,
        input.bitacoraId,
      );
      if (affected === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Registro de bitácora no encontrado." });
      }
      return { ok: true as const };
    }),

  /**
   * Job: escanea bitacora_acceso y marca outliers según horario + IP whitelist.
   * Reglas:
   *   - fuera de horario clínico (horarioClinicoFin -> horarioClinicoInicio)
   *   - IP no está en la whitelist (si whitelist no vacía)
   */
  scanAndFlag: requireRole(["DIR"])
    .input(scanAndFlagInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const config = await getOrgConfig(ctx.prisma, orgId);

      // Defaults si no hay config
      const inicio = config?.horarioClinicoInicio ?? "06:00";
      const fin    = config?.horarioClinicoFin    ?? "22:00";
      const whitelist: string[] = config?.ipWhitelist ?? [];

      const desde = input.desde ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const hasta = input.hasta ?? new Date().toISOString();

      // Condición fuera de horario
      // Horario clínico: inicio <= hora < fin. Outlier: fuera de ese rango.
      const fueraHorario = `(
        EXTRACT(HOUR FROM b.ocurrido_en AT TIME ZONE 'America/El_Salvador') * 60
        + EXTRACT(MINUTE FROM b.ocurrido_en AT TIME ZONE 'America/El_Salvador')
      ) NOT BETWEEN (
        EXTRACT(HOUR FROM $3::time) * 60 + EXTRACT(MINUTE FROM $3::time)
      ) AND (
        EXTRACT(HOUR FROM $4::time) * 60 + EXTRACT(MINUTE FROM $4::time) - 1
      )`;

      // Condición IP no whitelisted (solo si whitelist no vacía)
      const params: unknown[] = [desde, hasta, inicio, fin];
      let ipCondition = "false"; // si whitelist vacía, no flaggeamos por IP
      if (whitelist.length > 0) {
        const placeholders = whitelist.map((_, i) => `$${params.length + 1 + i}`);
        params.push(...whitelist);
        ipCondition = `(b.ip_origen IS NOT NULL AND b.ip_origen NOT IN (${placeholders.join(",")}))`;
      }

      // Filtro org: JOIN implícito via FROM/WHERE para que el UPDATE
      // solo afecte registros del establecimiento de esta organización.
      const orgPlaceholder = `$${params.length + 1}`;
      params.push(orgId);

      const sql = `
        UPDATE ece.bitacora_acceso b
        SET flag_outlier = true,
            motivo_outlier = CASE
              WHEN ${fueraHorario} AND ${ipCondition !== "false" ? ipCondition : "false"}
                THEN 'Fuera de horario clínico e IP no whitelisted'
              WHEN ${fueraHorario}
                THEN 'Fuera de horario clínico'
              WHEN ${ipCondition !== "false" ? ipCondition : "false"}
                THEN 'IP no whitelisted'
              ELSE motivo_outlier
            END
        FROM ece.establecimiento est
        JOIN ece.institucion i ON est.institucion_id = i.id
        WHERE b.establecimiento_id = est.id
          AND i.organization_id = ${orgPlaceholder}::uuid
          AND b.ocurrido_en BETWEEN $1::timestamptz AND $2::timestamptz
          AND b.flag_outlier = false
          AND (${fueraHorario} OR ${ipCondition !== "false" ? ipCondition : "false"})
      `;

      const affected = await ctx.prisma.$executeRawUnsafe(sql, ...params);
      return { ok: true as const, flagged: Number(affected) };
    }),

  /**
   * Estadísticas para el dashboard DIR (US.F2.7.16).
   * Retorna: totalAccesos, totalOutliers, accesosSensibles, porAccion.
   */
  dashboardStats: requireRole(["DIR"])
    .input(dashboardStatsInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const conditions: string[] = [`i.organization_id = $1::uuid`];
      const params: unknown[] = [orgId];
      let idx = 2;

      if (input.desde) {
        conditions.push(`b.ocurrido_en >= $${idx++}::timestamptz`);
        params.push(input.desde);
      }
      if (input.hasta) {
        conditions.push(`b.ocurrido_en <= $${idx++}::timestamptz`);
        params.push(input.hasta);
      }
      const where = conditions.join(" AND ");

      const [totalRows, outlierRows, topUserRows] = await Promise.all([
        ctx.prisma.$queryRawUnsafe<BigintRow[]>(
          `SELECT COUNT(*) AS count FROM ece.bitacora_acceso b ${ORG_JOIN} WHERE ${where}`,
          ...params,
        ),
        ctx.prisma.$queryRawUnsafe<BigintRow[]>(
          `SELECT COUNT(*) AS count FROM ece.bitacora_acceso b ${ORG_JOIN} WHERE ${where} AND b.flag_outlier = true`,
          ...params,
        ),
        ctx.prisma.$queryRawUnsafe<UserRow[]>(
          `SELECT b.auth_user_id, COUNT(*) AS count
           FROM ece.bitacora_acceso b ${ORG_JOIN}
           WHERE ${where} AND b.auth_user_id IS NOT NULL
           GROUP BY b.auth_user_id
           ORDER BY count DESC
           LIMIT 10`,
          ...params,
        ),
      ]);

      return {
        totalAccesos:    Number(totalRows[0]?.count ?? 0),
        totalOutliers:   Number(outlierRows[0]?.count ?? 0),
        topUsuarios: topUserRows.map((r) => ({
          authUserId: r.auth_user_id,
          accesos:    Number(r.count),
        })),
      };
    }),

  /**
   * Top 10 usuarios por accesos en el último mes.
   */
  topUsers: requireRole(["DIR", "ARCH"])
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const rows = await ctx.prisma.$queryRawUnsafe<UserRow[]>(
        `SELECT b.auth_user_id, COUNT(*) AS count
         FROM ece.bitacora_acceso b ${ORG_JOIN}
         WHERE i.organization_id = $1::uuid
           AND b.ocurrido_en >= now() - INTERVAL '30 days'
           AND b.auth_user_id IS NOT NULL
         GROUP BY b.auth_user_id
         ORDER BY count DESC
         LIMIT $2`,
        orgId,
        input.limit,
      );
      return rows.map((r) => ({
        authUserId: r.auth_user_id,
        accesos:    Number(r.count),
      }));
    }),

  /**
   * Accesos a expedientes sensibles (recurso_id con etiqueta VIP/mental/HIV).
   * Simplificado: filtra por justificacion ILIKE '%VIP%' OR '%mental%' OR '%HIV%'.
   */
  sensitiveAccess: requireRole(["DIR"])
    .input(listOutliersInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const conditions: string[] = [
        `i.organization_id = $1::uuid`,
        "(b.justificacion ILIKE '%VIP%' OR b.justificacion ILIKE '%mental%' OR b.justificacion ILIKE '%HIV%')",
      ];
      const params: unknown[] = [orgId];
      let idx = 2;
      if (input.desde) { conditions.push(`b.ocurrido_en >= $${idx++}::timestamptz`); params.push(input.desde); }
      if (input.hasta) { conditions.push(`b.ocurrido_en <= $${idx++}::timestamptz`); params.push(input.hasta); }
      const where = conditions.join(" AND ");

      const countRows = await ctx.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS total FROM ece.bitacora_acceso b ${ORG_JOIN} WHERE ${where}`,
        ...params,
      );
      const total = Number(countRows[0]?.total ?? 0);

      const dataParams = [...params, input.limit, input.offset];
      const rows = await ctx.prisma.$queryRawUnsafe<OutlierRow[]>(
        `SELECT b.id, b.personal_id, b.auth_user_id, b.accion, b.autorizado,
                b.ip_origen, b.ocurrido_en, b.flag_outlier, b.motivo_outlier, b.recurso_id
         FROM ece.bitacora_acceso b ${ORG_JOIN}
         WHERE ${where}
         ORDER BY b.ocurrido_en DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        ...dataParams,
      );

      return {
        items: rows.map((r) => ({
          id:          r.id,
          personalId:  r.personal_id,
          authUserId:  r.auth_user_id,
          accion:      r.accion,
          autorizado:  r.autorizado,
          ipOrigen:    r.ip_origen,
          ocurridoEn:  r.ocurrido_en.toISOString(),
          recursoId:   r.recurso_id,
        })),
        total,
      };
    }),

  /**
   * Lee la config de AuditDashboard de la organización actual.
   */
  getConfig: tenantProcedure
    .query(async ({ ctx }) => {
      const config = await getOrgConfig(ctx.prisma, ctx.tenant.organizationId);
      return config ?? {
        id:                    null,
        organizationId:        ctx.tenant.organizationId,
        ipWhitelist:           [],
        horarioClinicoInicio:  "06:00",
        horarioClinicoFin:     "22:00",
        outlierAlertEnabled:   true,
      };
    }),

  /**
   * Crea/actualiza la config de la organización.
   */
  upsertConfig: requireRole(["DIR"])
    .input(upsertConfigInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public."AuditDashboardConfig"
             ("organizationId", "ipWhitelist", "horarioClinicoInicio", "horarioClinicoFin", "outlierAlertEnabled")
           VALUES ($1::uuid, $2::text[], $3::time, $4::time, $5)
           ON CONFLICT ("organizationId") DO UPDATE
             SET "ipWhitelist"          = EXCLUDED."ipWhitelist",
                 "horarioClinicoInicio" = EXCLUDED."horarioClinicoInicio",
                 "horarioClinicoFin"    = EXCLUDED."horarioClinicoFin",
                 "outlierAlertEnabled"  = EXCLUDED."outlierAlertEnabled",
                 "updatedAt"            = now()`,
          orgId,
          input.ipWhitelist,
          input.horarioClinicoInicio,
          input.horarioClinicoFin,
          input.outlierAlertEnabled,
        );
      });
      return { ok: true as const };
    }),
});
