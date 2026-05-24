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
 *   ece.bitacora_acceso  — log inmutable append-only:
 *     id BIGINT PK GENERATED ALWAYS AS IDENTITY (no UUID — ref. PR #225),
 *     firma_id uuid nullable FK(ece.firma_electronica),
 *     user_id uuid NOT NULL, paciente_id uuid nullable,
 *     accion text NOT NULL, exito boolean NOT NULL,
 *     contexto text nullable, ip text nullable,
 *     registrado_en timestamptz NOT NULL DEFAULT now()
 *   ece.firma_electronica — referenciada para accesos con firma (firma_id)
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
  pacienteId: z.string().uuid().optional(),
  personalId: z.string().uuid().optional(),
  desde:      z.string().datetime().optional(),
  hasta:      z.string().datetime().optional(),
  accion:     accionEnum.optional(),
  limit:      z.number().int().min(1).max(200).default(50),
  offset:     z.number().int().min(0).default(0),
});

const bitacoraExportInput = z.object({
  pacienteId: z.string().uuid().optional(),
  personalId: z.string().uuid().optional(),
  desde:      z.string().datetime().optional(),
  hasta:      z.string().datetime().optional(),
  accion:     accionEnum.optional(),
});

const bitacoraRegisterInput = z.object({
  firmaId:    z.string().uuid().optional(),
  userId:     z.string().uuid(),
  pacienteId: z.string().uuid().optional(),
  accion:     accionEnum,
  exito:      z.boolean().default(true),
  contexto:   z.string().max(500).optional(),
  ip:         z.string().max(45).optional(),
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
// Tipos raw SQL
// ---------------------------------------------------------------------------

type BitacoraDbRow = {
  id: string;
  firma_id: string | null;
  user_id: string;
  paciente_id: string | null;
  accion: string;
  exito: boolean;
  contexto: string | null;
  ip: string | null;
  registrado_en: Date;
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

  if (input.pacienteId) {
    conditions.push(`b.paciente_id = $${idx++}::uuid`);
    params.push(input.pacienteId);
  }
  if (input.personalId) {
    // personalId filtra por firma_id vinculada al personal.
    conditions.push(
      `b.firma_id IN (SELECT id FROM ece.firma_electronica WHERE personal_id = $${idx++}::uuid)`,
    );
    params.push(input.personalId);
  }
  if (input.desde) {
    conditions.push(`b.registrado_en >= $${idx++}::timestamptz`);
    params.push(input.desde);
  }
  if (input.hasta) {
    conditions.push(`b.registrado_en <= $${idx++}::timestamptz`);
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
    id:           r.id,
    firmaId:      r.firma_id,
    userId:       r.user_id,
    pacienteId:   r.paciente_id,
    accion:       r.accion,
    exito:        r.exito,
    contexto:     r.contexto,
    ip:           r.ip,
    registradoEn: r.registrado_en.toISOString(),
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
        SELECT b.id, b.firma_id, b.user_id, b.paciente_id,
               b.accion, b.exito, b.contexto, b.ip, b.registrado_en
        FROM ece.bitacora_acceso b
        WHERE ${clause}
        ORDER BY b.registrado_en DESC
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
        SELECT b.id, b.firma_id, b.user_id, b.paciente_id,
               b.accion, b.exito, b.contexto, b.ip, b.registrado_en
        FROM ece.bitacora_acceso b
        WHERE ${clause}
        ORDER BY b.registrado_en DESC
        LIMIT 10000
      `;
      const rows = await ctx.prisma.$queryRawUnsafe<BitacoraDbRow[]>(
        sql,
        ...params,
      );

      const header = toCsvLine([
        "id", "firma_id", "user_id", "paciente_id",
        "accion", "exito", "contexto", "ip", "registrado_en",
      ]);
      const lines = rows.map((r) =>
        toCsvLine([
          r.id,
          r.firma_id ?? "",
          r.user_id,
          r.paciente_id ?? "",
          r.accion,
          String(r.exito),
          r.contexto ?? "",
          r.ip ?? "",
          r.registrado_en.toISOString(),
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
        conditions.push(`b.registrado_en >= $${idx++}::timestamptz`);
        params.push(input.desde);
      }
      if (input.hasta) {
        conditions.push(`b.registrado_en <= $${idx++}::timestamptz`);
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

      // Top 5 documentos (por contexto)
      const topDocRows = await ctx.prisma.$queryRawUnsafe<TopDocRow[]>(
        `SELECT b.contexto, COUNT(*) AS count
         FROM ece.bitacora_acceso b
         WHERE ${where} AND b.contexto IS NOT NULL
         GROUP BY b.contexto
         ORDER BY count DESC
         LIMIT 5`,
        ...params,
      );
      const topDocumentos = topDocRows.map((r) => ({
        documento: r.contexto,
        accesos: Number(r.count),
      }));

      // Top 5 usuarios
      const topUserRows = await ctx.prisma.$queryRawUnsafe<TopUserRow[]>(
        `SELECT b.user_id, COUNT(*) AS count
         FROM ece.bitacora_acceso b
         WHERE ${where}
         GROUP BY b.user_id
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
      // El userId del input debe coincidir con el usuario en sesión, salvo
      // que sea el propio sistema (firmaId nulo = log de sistema).
      if (input.userId !== ctx.user.id && input.firmaId !== undefined) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo puede registrar eventos propios.",
        });
      }

      const firmaId   = input.firmaId   ?? null;
      const paciente  = input.pacienteId ?? null;
      const contexto  = input.contexto   ?? null;
      const ip        = input.ip         ?? null;

      await ctx.prisma.$executeRawUnsafe(
        `INSERT INTO ece.bitacora_acceso
           (firma_id, user_id, paciente_id, accion, exito, contexto, ip, registrado_en)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, now())`,
        firmaId,
        input.userId,
        paciente,
        input.accion,
        input.exito,
        contexto,
        ip,
      );

      return { ok: true as const };
    }),
});
