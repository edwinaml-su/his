/**
 * Router tRPC — ECE Bitácora de Acceso al Expediente Clínico.
 *
 * Norma: NTEC Arts. 45-52 (MINSAL Acuerdo n.° 1616, 2024).
 * Requisito regulatorio: todo acceso al ECE —lectura, escritura, firma,
 *   certificación, impresión, exportación— debe registrarse en la bitácora
 *   con usuario, acción, resultado (éxito/fallo), IP y contexto.
 *   Retención mínima legal: 10 años (Art. 51 NTEC).
 * Código de módulo: ECE-BITACORA.
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW
 * ---------------------------------------------------------------------------
 *   No aplica workflow de documento (NTEC). La bitácora es append-only:
 *   INSERT únicamente, sin UPDATE ni DELETE permitidos desde la capa de aplicación.
 *   La inmutabilidad se refuerza con RLS Postgres (rol authenticated solo puede
 *   INSERT en ece.bitacora_acceso; SELECT requiere rol DIR o ARCH).
 *
 * ---------------------------------------------------------------------------
 * OUTBOX
 * ---------------------------------------------------------------------------
 *   No emite eventos de dominio. Es en sí misma un log de consumo, no de producción.
 *   Otros routers (certificacion, rri, consentimiento, etc.) invocan
 *   `bitacora.register` post-transacción para registrar sus acciones.
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.bitacora_acceso  — log inmutable append-only (cols reales 2026-06-11):
 *     id bigint PK GENERATED ALWAYS AS IDENTITY,
 *     personal_id uuid nullable FK(ece.personal_salud),
 *     recurso_id uuid nullable,
 *     accion text NOT NULL,
 *     autorizado boolean NOT NULL,
 *     ip_origen inet nullable,
 *     ocurrido_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 *     justificacion text nullable,
 *     auth_user_id uuid nullable,
 *     establecimiento_id uuid nullable FK(ece.establecimiento),
 *     flag_outlier boolean NOT NULL DEFAULT false,
 *     motivo_outlier varchar nullable
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   list        → requireRole(["DIR","ARCH"])   — paginada con filtros
 *   exportCsv   → requireRole(["DIR","ARCH"])   — CSV base64 del período
 *   metrics     → requireRole(["DIR","ARCH"])   — conteos por acción/período
 *   register    → protectedProcedure           — cualquier usuario autenticado
 *                 (los routers lo invocan internamente, no el cliente directamente)
 *
 * Accion enum (NTEC Arts. 45-52 + legacy genérico):
 *   "FIRMAR" | "VALIDAR" | "CERTIFICAR" | "ANULAR" | "CREATE" | "UPDATE"
 *   "verify" | "confirm" | "view" | "create" | "update" | "delete" |
 *   "export" | "print" | "share"
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireRole, router } from "../../trpc";
import { requireEcePermission } from "../../middleware/ece-permission";

// ---------------------------------------------------------------------------
// Schemas Zod (espejo de packages/contracts/src/schemas/ece-bitacora.ts)
// ---------------------------------------------------------------------------

/**
 * Enum extendido para soportar flujos NTEC firma/certificación/anulación.
 * Los valores legacy (verify/confirm/…) se mantienen por compatibilidad.
 */
const accionEnum = z.enum([
  // Operaciones genéricas (legacy)
  "verify", "confirm", "view", "create",
  "update", "delete", "export", "print", "share",
  // Operaciones ECE NTEC Arts. 45-52
  "FIRMAR", "VALIDAR", "CERTIFICAR", "ANULAR",
  "CREATE", "UPDATE",
]);

const bitacoraListInput = z.object({
  personalId: z.string().uuid().optional(),
  desde:      z.string().datetime().optional(),
  hasta:      z.string().datetime().optional(),
  accion:     accionEnum.optional(),
  limit:      z.number().int().min(1).max(200).default(50),
  offset:     z.number().int().min(0).default(0),
});

const bitacoraExportInput = z.object({
  personalId: z.string().uuid().optional(),
  desde:      z.string().datetime().optional(),
  hasta:      z.string().datetime().optional(),
  accion:     accionEnum.optional(),
});

const bitacoraRegisterInput = z.object({
  personalId:      z.string().uuid().optional(),
  recursoId:       z.string().uuid().optional(),
  accion:          accionEnum,
  autorizado:      z.boolean().default(true),
  justificacion:   z.string().max(500).optional(),
  ip:              z.string().max(45).optional(), // se convierte a inet en BD
  establecimientoId: z.string().uuid().optional(),
});

/**
 * Input para el endpoint de métricas del período.
 * Desde/hasta son ISO strings opcionales; sin filtro retorna todo el histórico.
 */
const bitacoraMetricsInput = z.object({
  desde: z.string().datetime().optional(),
  hasta: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Tipos raw SQL (columnas reales de ece.bitacora_acceso)
// ---------------------------------------------------------------------------

type BitacoraDbRow = {
  id: string; // bigint serializado como string
  personal_id: string | null;
  recurso_id: string | null;
  accion: string;
  autorizado: boolean;
  ip_origen: string | null;
  ocurrido_en: Date;
  justificacion: string | null;
  auth_user_id: string | null;
  establecimiento_id: string | null;
  flag_outlier: boolean;
  motivo_outlier: string | null;
};

type CountRow = { total: bigint };

type MetricCountRow = { count: bigint };
type TopDocRow = { contexto: string; count: bigint };
type TopUserRow = { user_id: string; count: bigint };

// ---------------------------------------------------------------------------
// Helpers de BD raw
// ---------------------------------------------------------------------------

/**
 * Construye la cláusula WHERE dinámica para los filtros comunes.
 * Retorna fragmentos SQL y los valores en el mismo orden.
 *
 * No usamos template literals aquí porque Prisma $queryRaw no admite
 * construcción dinámica de tagged templates de forma segura. En su lugar
 * usamos $queryRawUnsafe con parámetros posicionales $1, $2, …
 * que Postgres gestiona como prepared statements.
 */
function buildWhereClause(input: {
  pacienteId?: string;
  personalId?: string;
  desde?: string;
  hasta?: string;
  accion?: string;
}): { clause: string; params: unknown[] } {
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];
  let idx = 1;

  // paciente_id no existe en bitacora_acceso; filtrar por recurso_id es la aproximación más cercana
  // (recurso_id referencia el recurso accedido, que puede ser un episodio de un paciente).
  // Si el caller pasa pacienteId, se omite silenciosamente para no romper queries.
  // Mantener parámetro en firma por compatibilidad con listInput existente.
  if (input.personalId) {
    conditions.push(`b.personal_id = $${idx++}::uuid`);
    params.push(input.personalId);
  }
  if (input.desde) {
    conditions.push(`b.ocurrido_en >= $${idx++}::timestamptz`);
    params.push(input.desde);
  }
  if (input.hasta) {
    conditions.push(`b.ocurrido_en <= $${idx++}::timestamptz`);
    params.push(input.hasta);
  }
  if (input.accion) {
    conditions.push(`b.accion = $${idx++}`);
    params.push(input.accion);
  }

  return { clause: conditions.join(" AND "), params };
}

function rowToOutput(r: BitacoraDbRow) {
  return {
    id:               r.id,
    personalId:       r.personal_id,
    recursoId:        r.recurso_id,
    accion:           r.accion,
    autorizado:       r.autorizado,
    ipOrigen:         r.ip_origen,
    ocurridoEn:       r.ocurrido_en.toISOString(),
    justificacion:    r.justificacion,
    authUserId:       r.auth_user_id,
    establecimientoId: r.establecimiento_id,
    flagOutlier:      r.flag_outlier,
    motivoOutlier:    r.motivo_outlier,
  };
}

function toCsvLine(fields: string[]): string {
  return fields
    .map((f) => `"${(f ?? "").replace(/"/g, '""')}"`)
    .join(",");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const bitacoraRouter = router({
  /**
   * Lista paginada de accesos con filtros.
   * Solo roles DIR (director) y ARCH (archivo clínico).
   */
  list: requireEcePermission("ece.bitacora.read")
    .input(bitacoraListInput)
    .query(async ({ ctx, input }) => {
      const { clause, params } = buildWhereClause(input);

      // Total para paginación.
      const countSql = `SELECT COUNT(*) AS total FROM ece.bitacora_acceso b WHERE ${clause}`;
      const countRows = await ctx.prisma.$queryRawUnsafe<CountRow[]>(
        countSql,
        ...params,
      );
      const total = Number(countRows[0]?.total ?? 0);

      // Filas paginadas.
      const dataParams = [...params, input.limit, input.offset];
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      const dataSql = `
        SELECT b.id::text, b.personal_id, b.recurso_id, b.accion, b.autorizado,
               b.ip_origen::text, b.ocurrido_en, b.justificacion,
               b.auth_user_id, b.establecimiento_id, b.flag_outlier, b.motivo_outlier
        FROM ece.bitacora_acceso b
        WHERE ${clause}
        ORDER BY b.ocurrido_en DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
      const rows = await ctx.prisma.$queryRawUnsafe<BitacoraDbRow[]>(
        dataSql,
        ...dataParams,
      );

      return {
        items: rows.map(rowToOutput),
        total,
      };
    }),

  /**
   * Genera CSV de los accesos filtrados.
   * Devuelve base64 para que el cliente construya el blob de descarga.
   * Máximo 10 000 filas por exportación (protección de memoria).
   */
  exportCsv: requireRole(["DIR", "ARCH"])
    .input(bitacoraExportInput)
    .query(async ({ ctx, input }) => {
      const { clause, params } = buildWhereClause(input);

      const sql = `
        SELECT b.id::text, b.personal_id, b.recurso_id, b.accion, b.autorizado,
               b.ip_origen::text, b.ocurrido_en, b.justificacion,
               b.auth_user_id, b.establecimiento_id, b.flag_outlier, b.motivo_outlier
        FROM ece.bitacora_acceso b
        WHERE ${clause}
        ORDER BY b.ocurrido_en DESC
        LIMIT 10000
      `;
      const rows = await ctx.prisma.$queryRawUnsafe<BitacoraDbRow[]>(
        sql,
        ...params,
      );

      const header = toCsvLine([
        "id", "personal_id", "recurso_id", "accion", "autorizado",
        "ip_origen", "ocurrido_en", "justificacion",
        "auth_user_id", "establecimiento_id", "flag_outlier", "motivo_outlier",
      ]);
      const lines = rows.map((r) =>
        toCsvLine([
          r.id,
          r.personal_id ?? "",
          r.recurso_id ?? "",
          r.accion,
          String(r.autorizado),
          r.ip_origen ?? "",
          r.ocurrido_en.toISOString(),
          r.justificacion ?? "",
          r.auth_user_id ?? "",
          r.establecimiento_id ?? "",
          String(r.flag_outlier),
          r.motivo_outlier ?? "",
        ]),
      );

      const csv = [header, ...lines].join("\n");
      const base64 = Buffer.from(csv, "utf-8").toString("base64");

      return { base64, rowCount: rows.length };
    }),

  /**
   * Métricas del período para el resumen de la bitácora.
   * Retorna:
   *   totalAccesos — total de eventos en el período.
   *   totalFirmas  — eventos de acciones críticas (FIRMAR/CERTIFICAR/ANULAR/VALIDAR).
   *   topDocumentos — top 5 contextos más frecuentes (proxy de documento).
   *   topUsuarios   — top 5 user_id con más accesos.
   */
  metrics: requireRole(["DIR", "ARCH"])
    .input(bitacoraMetricsInput)
    .query(async ({ ctx, input }) => {
      const conditions: string[] = ["1=1"];
      const params: unknown[] = [];
      let idx = 1;

      if (input.desde) {
        conditions.push(`b.ocurrido_en >= $${idx++}::timestamptz`);
        params.push(input.desde);
      }
      if (input.hasta) {
        conditions.push(`b.ocurrido_en <= $${idx++}::timestamptz`);
        params.push(input.hasta);
      }
      const where = conditions.join(" AND ");

      // Total accesos
      const totalRows = await ctx.prisma.$queryRawUnsafe<MetricCountRow[]>(
        `SELECT COUNT(*) AS count FROM ece.bitacora_acceso b WHERE ${where}`,
        ...params,
      );
      const totalAccesos = Number(totalRows[0]?.count ?? 0);

      // Total firmas (acciones críticas)
      const accionesCriticas = ["FIRMAR", "CERTIFICAR", "ANULAR", "VALIDAR"];
      const criticas = accionesCriticas.map((_, i) => `$${idx + i}`).join(", ");
      const firmasParams = [...params, ...accionesCriticas];
      const firmasRows = await ctx.prisma.$queryRawUnsafe<MetricCountRow[]>(
        `SELECT COUNT(*) AS count FROM ece.bitacora_acceso b WHERE ${where} AND b.accion IN (${criticas})`,
        ...firmasParams,
      );
      const totalFirmas = Number(firmasRows[0]?.count ?? 0);

      // Top 5 recursos (por recurso_id — proxy de documento accedido)
      const topDocRows = await ctx.prisma.$queryRawUnsafe<TopDocRow[]>(
        `SELECT b.recurso_id::text AS contexto, COUNT(*) AS count
         FROM ece.bitacora_acceso b
         WHERE ${where} AND b.recurso_id IS NOT NULL
         GROUP BY b.recurso_id
         ORDER BY count DESC
         LIMIT 5`,
        ...params,
      );
      const topDocumentos = topDocRows.map((r) => ({
        documento: r.contexto,
        accesos: Number(r.count),
      }));

      // Top 5 usuarios (por auth_user_id)
      const topUserRows = await ctx.prisma.$queryRawUnsafe<TopUserRow[]>(
        `SELECT b.auth_user_id::text AS user_id, COUNT(*) AS count
         FROM ece.bitacora_acceso b
         WHERE ${where} AND b.auth_user_id IS NOT NULL
         GROUP BY b.auth_user_id
         ORDER BY count DESC
         LIMIT 5`,
        ...params,
      );
      const topUsuarios = topUserRows.map((r) => ({
        userId: r.user_id,
        accesos: Number(r.count),
      }));

      return { totalAccesos, totalFirmas, topDocumentos, topUsuarios };
    }),

  /**
   * Registra un evento de acceso manualmente.
   * Usado por otros routers ECE (firma.router, workflow.router, etc.)
   * para insertar en ece.bitacora_acceso sin bypassear RLS.
   *
   * protectedProcedure: cualquier usuario autenticado puede registrar
   * (el control de quién puede ver los registros está en list/exportCsv).
   */
  register: protectedProcedure
    .input(bitacoraRegisterInput)
    .mutation(async ({ ctx, input }) => {
      const personalId      = input.personalId      ?? null;
      const recursoId       = input.recursoId       ?? null;
      const justificacion   = input.justificacion   ?? null;
      // ip_origen es tipo inet en BD; cast explícito en SQL
      const ipOrigen        = input.ip              ?? null;
      const establecimientoId = input.establecimientoId ?? null;

      await ctx.prisma.$executeRawUnsafe(
        `INSERT INTO ece.bitacora_acceso
           (personal_id, recurso_id, accion, autorizado, ip_origen,
            justificacion, auth_user_id, establecimiento_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::inet, $6, $7::uuid, $8::uuid)`,
        personalId,
        recursoId,
        input.accion,
        input.autorizado,
        ipOrigen,
        justificacion,
        ctx.user.id,
        establecimientoId,
      );

      return { ok: true as const };
    }),
});
