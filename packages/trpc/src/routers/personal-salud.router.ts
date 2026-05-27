/**
 * Router tRPC — Mantenimiento de Personal de Salud (Médicos y No-Médicos).
 *
 * Modelo B2B2C: los médicos son clientes del hospital que traen sus pacientes
 * para ser operados; el personal no-médico (enfermería, auxiliares, archivo)
 * los asiste. Ambos viven en `ece.personal_salud` con diferentes roles ECE
 * asignados en `ece.asignacion_rol`.
 *
 * Tipos de personal (filtro `kind`):
 *   - "medicos"      → roles MC, MT, ESP, IC (Médico Cabecera, Turno, Especialista, Interconsultante)
 *   - "no_medicos"   → roles ENF, ARCH, AC, ADM (Enfermería, Archivo, Atención al cliente, Administrativo)
 *   - "todos"        → cualquier rol
 *
 * Procedures:
 *   - list({ kind, search, activo, limit, offset })
 *   - get(id)
 *   - create(input)         requireRole(["ADMIN", "DIR"])
 *   - update(id, fields)    requireRole(["ADMIN", "DIR"])
 *   - setActive(id, activo) requireRole(["ADMIN", "DIR"])
 *   - listRoles({ kind })   catálogo filtrado para selectors del form
 *
 * Aislamiento: la tabla `ece.personal_salud` se filtra por `establecimiento_id`
 * del tenant. RLS aplica vía `withWorkflowContext`.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";

// ---------------------------------------------------------------------------
// Constantes — clasificación de roles ECE por tipo de personal
// ---------------------------------------------------------------------------

/** Roles ECE que clasifican a un profesional como MÉDICO. */
export const MEDICO_ROLES = ["MC", "MT", "ESP", "IC"] as const;

/** Roles ECE que clasifican a un profesional como NO-MÉDICO. */
export const NO_MEDICO_ROLES = ["ENF", "ARCH", "AC", "ADM"] as const;

const kindEnum = z.enum(["medicos", "no_medicos", "todos"]);

// ---------------------------------------------------------------------------
// Schemas Zod — inputs
// ---------------------------------------------------------------------------

const listInput = z.object({
  kind: kindEnum.default("todos"),
  search: z.string().max(200).optional(),
  activo: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const createInput = z.object({
  documentoIdentidad: z.string().trim().min(1).max(40),
  nombreCompleto: z.string().trim().min(3).max(200),
  jvpmOJvp: z.string().trim().max(40).optional(),
  profesion: z.string().trim().max(100).optional(),
  rolCodigos: z.array(z.string().min(1).max(20)).min(1),
});

const updateInput = z.object({
  id: z.string().uuid(),
  nombreCompleto: z.string().trim().min(3).max(200).optional(),
  jvpmOJvp: z.string().trim().max(40).nullable().optional(),
  profesion: z.string().trim().max(100).nullable().optional(),
  rolCodigos: z.array(z.string().min(1).max(20)).optional(),
});

const setActiveInput = z.object({
  id: z.string().uuid(),
  activo: z.boolean(),
});

// ---------------------------------------------------------------------------
// Tipos de fila para raw queries
// ---------------------------------------------------------------------------

interface PersonalRow {
  id: string;
  documento_identidad: string;
  nombre_completo: string;
  jvpm_o_jvp: string | null;
  profesion: string | null;
  activo: boolean;
  fecha_baja: Date | null;
  creado_en: Date;
  roles_codigos: string[];
  roles_nombres: string[];
  auth_user_id: string | null;
}

// ---------------------------------------------------------------------------
// Helper: resolver establecimiento del tenant
// ---------------------------------------------------------------------------

function resolveEstablecimiento(ctx: { tenant: { establishmentId?: string } }): string {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo en la sesión.",
    });
  }
  return ctx.tenant.establishmentId;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const personalSaludRouter = router({
  /**
   * Lista personal de salud filtrable por tipo (médicos/no-médicos/todos),
   * texto libre (nombre o documento) y estado activo. Devuelve roles ECE
   * agregados como array.
   */
  list: tenantProcedure.input(listInput).query(async ({ ctx, input }) => {
    const estab = resolveEstablecimiento(ctx);
    const codes =
      input.kind === "medicos" ? Array.from(MEDICO_ROLES)
      : input.kind === "no_medicos" ? Array.from(NO_MEDICO_ROLES)
      : null;

    const searchPattern = input.search ? `%${input.search.trim()}%` : null;
    const activoFilter = input.activo ?? null;

    const rows = await ctx.prisma.$queryRaw<PersonalRow[]>`
      SELECT
        p.id::text,
        p.documento_identidad,
        p.nombre_completo,
        p.jvpm_o_jvp,
        p.profesion,
        p.activo,
        p.fecha_baja,
        p.creado_en,
        p.auth_user_id::text,
        COALESCE(ARRAY_AGG(r.codigo) FILTER (WHERE r.codigo IS NOT NULL), '{}')::text[] AS roles_codigos,
        COALESCE(ARRAY_AGG(r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '{}')::text[] AS roles_nombres
      FROM ece.personal_salud p
      LEFT JOIN ece.asignacion_rol ar ON ar.personal_id = p.id AND ar.vigente = true
      LEFT JOIN ece.rol r ON r.id = ar.rol_id
      WHERE p.establecimiento_id = ${estab}::uuid
        AND (${activoFilter}::boolean IS NULL OR p.activo = ${activoFilter}::boolean)
        AND (${searchPattern}::text IS NULL OR
             p.nombre_completo ILIKE ${searchPattern}::text OR
             p.documento_identidad ILIKE ${searchPattern}::text)
      GROUP BY p.id
      ORDER BY p.nombre_completo ASC
      LIMIT ${input.limit}
      OFFSET ${input.offset}
    `;

    // El HAVING dentro de template tagged no funciona perfecto en Prisma;
    // hacemos el filtro en JS sobre el resultado para evitar bugs.
    const codeSet: Set<string> | null = codes ? new Set<string>(codes) : null;
    const filtered = codeSet
      ? rows.filter((r) => r.roles_codigos.some((c) => codeSet.has(c)))
      : rows;

    return filtered.map((r) => ({
      id: r.id,
      documentoIdentidad: r.documento_identidad,
      nombreCompleto: r.nombre_completo,
      jvpmOJvp: r.jvpm_o_jvp,
      profesion: r.profesion,
      activo: r.activo,
      fechaBaja: r.fecha_baja?.toISOString() ?? null,
      creadoEn: r.creado_en.toISOString(),
      authUserId: r.auth_user_id,
      roles: r.roles_codigos.map((codigo, idx) => ({
        codigo,
        nombre: r.roles_nombres[idx] ?? codigo,
      })),
    }));
  }),

  /** Detalle de un profesional + roles asignados + estado firma electrónica. */
  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const estab = resolveEstablecimiento(ctx);

      const rows = await ctx.prisma.$queryRaw<
        Array<PersonalRow & { firma_activa: boolean }>
      >`
        SELECT
          p.id::text,
          p.documento_identidad,
          p.nombre_completo,
          p.jvpm_o_jvp,
          p.profesion,
          p.activo,
          p.fecha_baja,
          p.creado_en,
          p.auth_user_id::text,
          COALESCE(ARRAY_AGG(r.codigo) FILTER (WHERE r.codigo IS NOT NULL), '{}')::text[] AS roles_codigos,
          COALESCE(ARRAY_AGG(r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '{}')::text[] AS roles_nombres,
          EXISTS (
            SELECT 1 FROM ece.firma_electronica fe
            WHERE fe.personal_id = p.id AND fe.revoked_at IS NULL
          ) AS firma_activa
        FROM ece.personal_salud p
        LEFT JOIN ece.asignacion_rol ar ON ar.personal_id = p.id AND ar.vigente = true
        LEFT JOIN ece.rol r ON r.id = ar.rol_id
        WHERE p.id = ${input.id}::uuid
          AND p.establecimiento_id = ${estab}::uuid
        GROUP BY p.id
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Profesional no encontrado." });
      }

      return {
        id: row.id,
        documentoIdentidad: row.documento_identidad,
        nombreCompleto: row.nombre_completo,
        jvpmOJvp: row.jvpm_o_jvp,
        profesion: row.profesion,
        activo: row.activo,
        fechaBaja: row.fecha_baja?.toISOString() ?? null,
        creadoEn: row.creado_en.toISOString(),
        authUserId: row.auth_user_id,
        firmaActiva: row.firma_activa,
        roles: row.roles_codigos.map((codigo, idx) => ({
          codigo,
          nombre: row.roles_nombres[idx] ?? codigo,
        })),
      };
    }),

  /**
   * Crea un nuevo profesional de salud + asignaciones de rol ECE.
   * Idempotencia: si el documento ya existe en el establecimiento, devuelve
   * CONFLICT — el operador debe usar update.
   */
  create: requireRole(["ADMIN", "DIR"])
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const estab = resolveEstablecimiento(ctx);
      const orgId = ctx.tenant.organizationId;

      // Resolver institucion_id desde establecimiento (FK requerida).
      const inst = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT institucion_id::text AS id FROM ece.establecimiento WHERE id = ${estab}::uuid LIMIT 1
      `;
      if (!inst[0]) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El establecimiento del tenant no tiene institución ECE vinculada.",
        });
      }

      // Verificar duplicado por documento_identidad dentro del establecimiento.
      const existing = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM ece.personal_salud
        WHERE documento_identidad = ${input.documentoIdentidad}
          AND establecimiento_id = ${estab}::uuid
        LIMIT 1
      `;
      if (existing[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ya existe un profesional con documento ${input.documentoIdentidad} en este establecimiento.`,
        });
      }

      // Resolver IDs de roles ECE por código.
      const roles = await ctx.prisma.$queryRaw<{ id: string; codigo: string }[]>`
        SELECT id::text, codigo FROM ece.rol WHERE codigo = ANY(${input.rolCodigos}::text[])
      `;
      if (roles.length !== input.rolCodigos.length) {
        const found = new Set(roles.map((r) => r.codigo));
        const missing = input.rolCodigos.filter((c) => !found.has(c));
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Roles ECE inválidos: ${missing.join(", ")}.`,
        });
      }

      const personal = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.personal_salud
            (institucion_id, establecimiento_id, documento_identidad,
             nombre_completo, jvpm_o_jvp, profesion, activo, creado_en)
          VALUES
            (${inst[0]!.id}::uuid, ${estab}::uuid, ${input.documentoIdentidad},
             ${input.nombreCompleto}, ${input.jvpmOJvp ?? null}, ${input.profesion ?? null},
             true, now())
          RETURNING id::text
        `;
        const newId = created[0]!.id;

        for (const role of roles) {
          await tx.$executeRaw`
            INSERT INTO ece.asignacion_rol (personal_id, rol_id, vigente, asignado_en)
            VALUES (${newId}::uuid, ${role.id}::uuid, true, now())
            ON CONFLICT (personal_id, rol_id, servicio_id) DO NOTHING
          `;
        }

        return { id: newId };
      });

      return { id: personal.id };
    }),

  /** Actualiza campos editables + sincroniza roles asignados. */
  update: requireRole(["ADMIN", "DIR"])
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const estab = resolveEstablecimiento(ctx);

      const target = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM ece.personal_salud
        WHERE id = ${input.id}::uuid AND establecimiento_id = ${estab}::uuid
        LIMIT 1
      `;
      if (!target[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Profesional no encontrado." });
      }

      await ctx.prisma.$transaction(async (tx) => {
        // Update de campos básicos solo si llegaron.
        const hasName = input.nombreCompleto !== undefined;
        const hasJvpm = input.jvpmOJvp !== undefined;
        const hasProf = input.profesion !== undefined;
        if (hasName || hasJvpm || hasProf) {
          await tx.$executeRaw`
            UPDATE ece.personal_salud
            SET
              nombre_completo = COALESCE(${hasName ? input.nombreCompleto : null}::text, nombre_completo),
              jvpm_o_jvp      = CASE WHEN ${hasJvpm}::boolean THEN ${input.jvpmOJvp ?? null}::text ELSE jvpm_o_jvp END,
              profesion       = CASE WHEN ${hasProf}::boolean THEN ${input.profesion ?? null}::text ELSE profesion END
            WHERE id = ${input.id}::uuid
          `;
        }

        // Sincronizar roles si llegaron.
        if (input.rolCodigos !== undefined) {
          const roles = await tx.$queryRaw<{ id: string; codigo: string }[]>`
            SELECT id::text, codigo FROM ece.rol WHERE codigo = ANY(${input.rolCodigos}::text[])
          `;
          if (roles.length !== input.rolCodigos.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Algunos roles ECE no existen.",
            });
          }
          // Desactivar todas las asignaciones actuales.
          await tx.$executeRaw`
            UPDATE ece.asignacion_rol SET vigente = false
            WHERE personal_id = ${input.id}::uuid AND vigente = true
          `;
          // Re-insertar / re-activar.
          for (const role of roles) {
            await tx.$executeRaw`
              INSERT INTO ece.asignacion_rol (personal_id, rol_id, vigente, asignado_en)
              VALUES (${input.id}::uuid, ${role.id}::uuid, true, now())
              ON CONFLICT (personal_id, rol_id, servicio_id)
                DO UPDATE SET vigente = true, asignado_en = now()
            `;
          }
        }
      });

      return { id: input.id };
    }),

  /** Toggle activo/inactivo — soft delete preservando histórico. */
  setActive: requireRole(["ADMIN", "DIR"])
    .input(setActiveInput)
    .mutation(async ({ ctx, input }) => {
      const estab = resolveEstablecimiento(ctx);

      const target = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM ece.personal_salud
        WHERE id = ${input.id}::uuid AND establecimiento_id = ${estab}::uuid
        LIMIT 1
      `;
      if (!target[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Profesional no encontrado." });
      }

      await ctx.prisma.$executeRaw`
        UPDATE ece.personal_salud
        SET activo = ${input.activo}::boolean,
            fecha_baja = CASE WHEN ${input.activo}::boolean THEN NULL ELSE now() END
        WHERE id = ${input.id}::uuid
      `;

      return { id: input.id, activo: input.activo };
    }),

  /**
   * Catálogo de roles ECE — útil para selectors en el form.
   * Filtra por tipo (médicos / no-médicos / todos).
   */
  listRoles: tenantProcedure
    .input(z.object({ kind: kindEnum.default("todos") }))
    .query(async ({ input }) => {
      const codes =
        input.kind === "medicos" ? Array.from(MEDICO_ROLES)
        : input.kind === "no_medicos" ? Array.from(NO_MEDICO_ROLES)
        : null;
      // No usamos prisma aquí — devolvemos el catálogo client-side hard-coded
      // por kind, con nombres legibles de la BD. Cargamos siempre todos y
      // filtramos en JS para evitar query extra (catálogo es pequeño).
      // En la práctica el cliente debería hacer una sola call con kind="todos"
      // y filtrar localmente.
      const ROLE_NAMES: Record<string, string> = {
        MC: "Médico de Cabecera",
        MT: "Médico de Turno",
        ESP: "Especialista",
        IC: "Interconsultante",
        ENF: "Enfermería",
        ARCH: "Archivo / ESDOMED",
        AC: "Atención al Cliente",
        ADM: "Administrativo",
        DIR: "Dirección",
      };
      const allCodes = codes ?? [...MEDICO_ROLES, ...NO_MEDICO_ROLES, "DIR"];
      return allCodes.map((codigo) => ({
        codigo,
        nombre: ROLE_NAMES[codigo] ?? codigo,
        tipo: (MEDICO_ROLES as readonly string[]).includes(codigo)
          ? ("medico" as const)
          : ("no_medico" as const),
      }));
    }),
});
