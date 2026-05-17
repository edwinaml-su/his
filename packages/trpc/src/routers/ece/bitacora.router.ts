/**
 * Stream ECE — Router tRPC: Bitácora de Acceso.
 *
 * Norma: NTEC Arts. 45-52 (Acuerdo n.° 1616, MINSAL 2024).
 * Registra y consulta accesos al expediente clínico electrónico (ECE).
 *
 * Tabla raw SQL: ece.bitacora_acceso
 * Columnas esperadas:
 *   id uuid PK, firma_id uuid nullable, user_id uuid NOT NULL,
 *   paciente_id uuid nullable, accion text NOT NULL, exito boolean NOT NULL,
 *   contexto text nullable, ip text nullable, registrado_en timestamptz NOT NULL.
 *
 * Procedures:
 *   bitacora.list     — query paginada (requireRole DIR|ARCH).
 *   bitacora.exportCsv — genera CSV base64 (requireRole DIR|ARCH).
 *   bitacora.register  — mutation: log manual de evento (protectedProcedure).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireRole, router } from "../../trpc";

// ---------------------------------------------------------------------------
// Schemas Zod (espejo de packages/contracts/src/schemas/ece-bitacora.ts)
// ---------------------------------------------------------------------------

const accionEnum = z.enum([
  "verify", "confirm", "view", "create",
  "update", "delete", "export", "print", "share",
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
  list: requireRole(["DIR", "ARCH"])
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
