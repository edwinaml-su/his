/**
 * Router tRPC: Catálogo GSRN Profesionales (US.F2.6.2).
 *
 * Gestiona el catálogo de GSRN asignados al personal de salud (médicos,
 * enfermería, farmacéuticos) con su badge institucional en DataMatrix.
 *
 * Tabla: ece.gs1_gsrn — filtra por tipo = 'profesional'.
 *
 * RBAC:
 *   list / validate: tenantProcedure (cualquier usuario del tenant)
 *   create / revoke / printBadge: requireRole(["ADMIN_CLINICO", "ADMIN"])
 *
 * withTenantContext: no requerido — ece.gs1_gsrn no tiene org_id RLS;
 * el aislamiento es por tenant_id gestionado por tenantProcedure / requireRole.
 */

import { randomInt } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";

// ---------------------------------------------------------------------------
// Validación GS1 Módulo-10 — fuente única en @his/contracts/validators/gs1
// ---------------------------------------------------------------------------

import { gs1CheckDigitValid } from "@his/contracts";

/** Genera un GSRN-18 con prefijo de empresa GS1 y dígito verificador correcto. */
function generateGsrn(companyPrefix: string = "801234567890"): string {
  // HI-20 (audit Stream I): randomInt usa CSPRNG (Node crypto). Antes
  // Math.random() era PRNG predecible — permitía enumeración de badges
  // institucionales válidos del personal médico (AI 8018).
  // Prefijo de empresa (12 dígitos) + referencia aleatoria (5 dígitos) + check digit.
  const random5 = randomInt(0, 100000).toString().padStart(5, "0");
  const root = companyPrefix + random5;
  let sum = 0;
  for (let i = 0; i < root.length; i++) {
    const weight = (root.length - 1 - i) % 2 === 0 ? 3 : 1;
    sum += parseInt(root[i]!, 10) * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return root + check.toString();
}

const gsrnSchema = z
  .string()
  .length(18)
  .regex(/^\d{18}$/, "GSRN-18: 18 dígitos numéricos")
  .refine(gs1CheckDigitValid, "Dígito verificador GS1 Módulo-10 inválido");

const paginationSchema = z.object({
  limit:  z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const statusFilter = z.enum(["ACTIVE", "REVOKED", "all"]).default("all");

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

interface StaffGsrnRow {
  id: string;
  codigo: string;
  referencia_id: string;      // FK a users (User.id)
  establecimiento_id: string | null;
  activo: boolean;
  nombre: string | null;
  rol: string | null;
  turno: string | null;
  creado_en: Date;
  actualizado_en: Date | null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const staffGsrnRouter = router({

  /**
   * Lista GSRNs de tipo 'profesional' con filtros opcionales de rol y status.
   */
  list: tenantProcedure
    .input(paginationSchema.extend({
      rol:    z.string().optional(),
      status: statusFilter.optional(),
    }))
    .query(async ({ ctx, input }) => {
      const conditions: string[] = ["g.tipo = 'profesional'"];
      const params: unknown[] = [];
      let idx = 1;

      if (input.status === "ACTIVE")  { conditions.push(`g.activo = true`); }
      if (input.status === "REVOKED") { conditions.push(`g.activo = false`); }
      if (input.rol) {
        conditions.push(`u.rol_code = $${idx++}`);
        params.push(input.rol);
      }
      params.push(input.limit, input.offset);

      const rows = await ctx.prisma.$queryRawUnsafe<StaffGsrnRow[]>(
        `SELECT g.id, g.codigo, g.referencia_id, g.establecimiento_id, g.activo,
                g.creado_en, g.actualizado_en,
                u.full_name AS nombre,
                r.code      AS rol,
                NULL::text  AS turno
           FROM ece.gs1_gsrn g
           LEFT JOIN "User" u ON u.id = g.referencia_id
           LEFT JOIN "UserRole" ur ON ur."userId" = u.id AND ur.active = true
           LEFT JOIN "Role" r ON r.id = ur."roleId"
          WHERE ${conditions.join(" AND ")}
          ORDER BY g.creado_en DESC
          LIMIT $${idx++} OFFSET $${idx++}`,
        ...params,
      );

      return rows.map((r) => ({
        id:               r.id,
        gsrn:             r.codigo,
        userId:           r.referencia_id,
        nombre:           r.nombre,
        rol:              r.rol,
        turno:            r.turno,
        establecimientoId: r.establecimiento_id,
        status:           r.activo ? ("ACTIVE" as const) : ("REVOKED" as const),
        creadoEn:         r.creado_en,
      }));
    }),

  /**
   * Crea un GSRN para un profesional.
   * Si autoGenerate = true, genera el código GS1 automáticamente.
   * Verifica unicidad de GSRN en la misma organización.
   */
  create: requireRole(["ADMIN_CLINICO", "ADMIN"])
    .input(z.object({
      userId:        z.string().uuid(),
      gsrn:          gsrnSchema.optional(),
      autoGenerate:  z.boolean().default(false),
      establecimientoId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let codigo: string;

      if (input.gsrn) {
        codigo = input.gsrn;
      } else if (input.autoGenerate) {
        codigo = generateGsrn();
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debe proveer gsrn o activar autoGenerate",
        });
      }

      // Verificar unicidad
      type CountRow = { cnt: string };
      const dup = await ctx.prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*)::text AS cnt FROM ece.gs1_gsrn WHERE codigo = $1 AND tipo = 'profesional'`,
        codigo,
      );
      if (parseInt(dup[0]!.cnt, 10) > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "ValidationError: GSRN_DUPLICADO",
        });
      }

      type IdRow = { id: string };
      const rows = await ctx.prisma.$queryRawUnsafe<IdRow[]>(
        `INSERT INTO ece.gs1_gsrn (codigo, tipo, referencia_id, establecimiento_id)
         VALUES ($1, 'profesional', $2::uuid, $3)
         RETURNING id`,
        codigo,
        input.userId,
        input.establecimientoId ?? null,
      );

      return { id: rows[0]!.id, gsrn: codigo };
    }),

  /**
   * Revoca un GSRN profesional con motivo.
   * Registrado en audit_log vía trigger de BD existente.
   * Hard Stop: cualquier escaneo posterior retorna PROFESIONAL_NO_HABILITADO.
   */
  revoke: requireRole(["ADMIN_CLINICO", "ADMIN"])
    .input(z.object({
      id:     z.string().uuid(),
      motivo: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verificar que existe y está activo
      type StatusRow = { activo: boolean };
      const current = await ctx.prisma.$queryRawUnsafe<StatusRow[]>(
        `SELECT activo FROM ece.gs1_gsrn WHERE id = $1::uuid AND tipo = 'profesional'`,
        input.id,
      );
      if (!current[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "GSRN profesional no encontrado" });
      }
      if (!current[0].activo) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "GSRN ya está revocado" });
      }

      await ctx.prisma.$executeRawUnsafe(
        `UPDATE ece.gs1_gsrn
            SET activo = false,
                actualizado_en = now()
          WHERE id = $1::uuid`,
        input.id,
      );

      // El motivo se persiste como evento de audit vía trigger automático de BD.
      // Adicionalmente lo registramos en la tabla de metadatos si existe.
      // Si no existe la columna motivo_revocacion, el log queda solo en audit_log.
      try {
        await ctx.prisma.$executeRawUnsafe(
          `UPDATE ece.gs1_gsrn SET motivo_revocacion = $1 WHERE id = $2::uuid`,
          input.motivo,
          input.id,
        );
      } catch {
        // columna opcional — no bloquear si no existe en esta versión del schema
      }

      return { ok: true as const };
    }),

  /**
   * Valida un GSRN profesional al escanear el badge.
   * Hard Stop si REVOKED → lanza PROFESIONAL_NO_HABILITADO.
   * Retorna nombre, rol y turno activo.
   */
  validate: tenantProcedure
    .input(z.object({ gsrn: z.string() }))
    .query(async ({ ctx, input }) => {
      // Validación de formato (no bloquea si dígito incorrecto — puede ser legacy)
      type ValidateRow = {
        id: string;
        referencia_id: string;
        activo: boolean;
        nombre: string | null;
        rol: string | null;
      };

      const rows = await ctx.prisma.$queryRawUnsafe<ValidateRow[]>(
        `SELECT g.id, g.referencia_id, g.activo,
                u.full_name AS nombre,
                r.code      AS rol
           FROM ece.gs1_gsrn g
           LEFT JOIN "User" u  ON u.id = g.referencia_id
           LEFT JOIN "UserRole" ur ON ur."userId" = u.id AND ur.active = true
           LEFT JOIN "Role" r  ON r.id = ur."roleId"
          WHERE g.codigo = $1 AND g.tipo = 'profesional'
          LIMIT 1`,
        input.gsrn,
      );

      if (!rows[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "GSRN_PROFESIONAL_NO_ENCONTRADO",
        });
      }

      const row = rows[0];

      // Hard Stop si revocado
      if (!row.activo) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "PROFESIONAL_NO_HABILITADO",
        });
      }

      // Consultar turno activo (tabla staff_schedule si existe)
      let turnoActivo: string | null = null;
      try {
        type TurnoRow = { turno: string };
        const turnos = await ctx.prisma.$queryRawUnsafe<TurnoRow[]>(
          `SELECT turno FROM ece.staff_schedule
            WHERE user_id = $1::uuid
              AND fecha = CURRENT_DATE
              AND activo = true
            LIMIT 1`,
          row.referencia_id,
        );
        turnoActivo = turnos[0]?.turno ?? null;
      } catch {
        // tabla staff_schedule aún no migrada — turno null
      }

      return {
        id:     row.id,
        userId: row.referencia_id,
        nombre: row.nombre,
        rol:    row.rol,
        turno:  turnoActivo,
        status: "ACTIVE" as const,
      };
    }),

  /**
   * Genera bytes PNG de DataMatrix para impresión del badge institucional.
   *
   * Retorna el DataMatrix como string Base64 (PNG 200x200 px).
   * En producción: llamar al servicio de impresión GLN-local.
   *
   * Implementación actual: genera el payload GS1 (AI 8018 + GSRN-18)
   * y retorna metadata para que el cliente renderice con una librería
   * de DataMatrix (e.g., bwip-js en el navegador).
   */
  printBadge: requireRole(["ADMIN_CLINICO", "ADMIN"])
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      type BadgeRow = {
        id: string;
        codigo: string;
        referencia_id: string;
        activo: boolean;
        nombre: string | null;
        rol: string | null;
      };

      const rows = await ctx.prisma.$queryRawUnsafe<BadgeRow[]>(
        `SELECT g.id, g.codigo, g.referencia_id, g.activo,
                u.full_name AS nombre,
                r.code      AS rol
           FROM ece.gs1_gsrn g
           LEFT JOIN "User" u  ON u.id = g.referencia_id
           LEFT JOIN "UserRole" ur ON ur."userId" = u.id AND ur.active = true
           LEFT JOIN "Role" r  ON r.id = ur."roleId"
          WHERE g.id = $1::uuid AND g.tipo = 'profesional'
          LIMIT 1`,
        input.id,
      );

      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "GSRN profesional no encontrado" });
      }

      const row = rows[0];

      // Payload GS1: AI (8018) + GSRN-18
      // El cliente usa bwip-js / DataMatrix renderer con este payload
      const gs1Payload = `(8018)${row.codigo}`;

      return {
        id:        row.id,
        gsrn:      row.codigo,
        nombre:    row.nombre,
        rol:       row.rol,
        gs1Payload,
        // Instrucciones para el renderer en el cliente:
        // bcid: "datamatrix", text: gs1Payload, scale: 3, height: 10
        rendererHints: {
          bcid:   "datamatrix",
          text:   gs1Payload,
          scale:  3,
          height: 10,
        },
      };
    }),
});
