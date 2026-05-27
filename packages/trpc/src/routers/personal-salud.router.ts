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

  /**
   * B2B2C — Pacientes referidos / atendidos por un profesional.
   *
   * Devuelve los Patient cuyos episodios (Inpatient/Surgery/Outpatient/Emergency)
   * tienen al profesional como attending/surgeon/provider/treating. Es la vista
   * core del modelo B2B2C: "¿qué pacientes me trajo este médico?".
   *
   * Requiere que `ece.personal_salud.auth_user_id` esté vinculado con un
   * User HIS. Si está NULL, devuelve lista vacía + advertencia.
   */
  getPacientesReferidos: tenantProcedure
    .input(
      z.object({
        personalId: z.string().uuid(),
        limit: z.number().int().min(1).max(500).default(100),
        // Filtros de rango por fecha del encuentro (inclusivo). Si NULL se omite el bound.
        fechaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        fechaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const estab = resolveEstablecimiento(ctx);
      const orgId = ctx.tenant.organizationId;

      // Verificar que el personal exista en el establecimiento + obtener authUserId.
      const rows = await ctx.prisma.$queryRaw<
        { id: string; auth_user_id: string | null; nombre_completo: string }[]
      >`
        SELECT id::text, auth_user_id::text, nombre_completo
        FROM ece.personal_salud
        WHERE id = ${input.personalId}::uuid AND establecimiento_id = ${estab}::uuid
        LIMIT 1
      `;
      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Profesional no encontrado." });
      }
      if (!rows[0].auth_user_id) {
        return {
          authUserLinked: false as const,
          pacientes: [],
          totalEncuentros: 0,
        };
      }
      const userId = rows[0].auth_user_id;

      // Query unificada: pacientes distintos donde el User aparece en algún
      // encuentro como tratante/cirujano/prestador.
      type PacienteRow = {
        patient_id: string;
        mrn: string;
        first_name: string;
        last_name: string;
        biological_sex_code: string | null;
        birth_date: Date | null;
        n_inpatient: number;
        n_surgery: number;
        n_outpatient: number;
        n_emergency: number;
        ultima_atencion: Date | null;
      };

      const desde = input.fechaDesde ?? null;
      const hasta = input.fechaHasta ?? null;

      const pacientes = await ctx.prisma.$queryRaw<PacienteRow[]>`
        WITH eventos AS (
          SELECT ia."patientId" AS patient_id,
                 ia."admittedAt"::timestamptz AS fecha,
                 'inpatient'::text AS tipo
          FROM public."InpatientAdmission" ia
          WHERE ia."attendingId" = ${userId}::uuid
            AND ia."organizationId" = ${orgId}::uuid
            AND (${desde}::date IS NULL OR ia."admittedAt"::date >= ${desde}::date)
            AND (${hasta}::date IS NULL OR ia."admittedAt"::date <= ${hasta}::date)
          UNION ALL
          SELECT sc."patientId", sc."scheduledStart"::timestamptz, 'surgery'
          FROM public."SurgeryCase" sc
          WHERE sc."primarySurgeonId" = ${userId}::uuid
            AND sc."organizationId" = ${orgId}::uuid
            AND (${desde}::date IS NULL OR sc."scheduledStart"::date >= ${desde}::date)
            AND (${hasta}::date IS NULL OR sc."scheduledStart"::date <= ${hasta}::date)
          UNION ALL
          SELECT oa."patientId", oa."scheduledAt"::timestamptz, 'outpatient'
          FROM public."OutpatientAppointment" oa
          WHERE oa."providerId" = ${userId}::uuid
            AND oa."organizationId" = ${orgId}::uuid
            AND (${desde}::date IS NULL OR oa."scheduledAt"::date >= ${desde}::date)
            AND (${hasta}::date IS NULL OR oa."scheduledAt"::date <= ${hasta}::date)
          UNION ALL
          SELECT ev."patientId", ev."arrivedAt"::timestamptz, 'emergency'
          FROM public."EmergencyVisit" ev
          WHERE ev."treatingId" = ${userId}::uuid
            AND ev."organizationId" = ${orgId}::uuid
            AND (${desde}::date IS NULL OR ev."arrivedAt"::date >= ${desde}::date)
            AND (${hasta}::date IS NULL OR ev."arrivedAt"::date <= ${hasta}::date)
        )
        SELECT
          p.id::text AS patient_id,
          p.mrn,
          p."firstName" AS first_name,
          p."lastName" AS last_name,
          bs.code AS biological_sex_code,
          p."birthDate" AS birth_date,
          COUNT(*) FILTER (WHERE e.tipo = 'inpatient')::int AS n_inpatient,
          COUNT(*) FILTER (WHERE e.tipo = 'surgery')::int AS n_surgery,
          COUNT(*) FILTER (WHERE e.tipo = 'outpatient')::int AS n_outpatient,
          COUNT(*) FILTER (WHERE e.tipo = 'emergency')::int AS n_emergency,
          MAX(e.fecha) AS ultima_atencion
        FROM eventos e
        JOIN public."Patient" p ON p.id = e.patient_id
        LEFT JOIN public."BiologicalSex" bs ON bs.id = p."biologicalSexId"
        WHERE p."organizationId" = ${orgId}::uuid
          AND p.active = true
        GROUP BY p.id, p.mrn, p."firstName", p."lastName", bs.code, p."birthDate"
        ORDER BY ultima_atencion DESC NULLS LAST
        LIMIT ${input.limit}
      `;

      const totalEncuentros = pacientes.reduce(
        (sum, r) => sum + r.n_inpatient + r.n_surgery + r.n_outpatient + r.n_emergency,
        0,
      );

      return {
        authUserLinked: true as const,
        pacientes: pacientes.map((r) => ({
          patientId: r.patient_id,
          mrn: r.mrn,
          firstName: r.first_name,
          lastName: r.last_name,
          biologicalSexCode: r.biological_sex_code,
          birthDate: r.birth_date?.toISOString() ?? null,
          conteos: {
            hospitalizacion: r.n_inpatient,
            cirugia: r.n_surgery,
            ambulatorio: r.n_outpatient,
            emergencia: r.n_emergency,
            total: r.n_inpatient + r.n_surgery + r.n_outpatient + r.n_emergency,
          },
          ultimaAtencion: r.ultima_atencion?.toISOString() ?? null,
        })),
        totalEncuentros,
      };
    }),

  /**
   * Vincula el personal con un User HIS existente (cuenta de acceso).
   * Necesario para que el procedure `getPacientesReferidos` pueda asociar
   * encuentros, y para que el médico pueda iniciar sesión.
   */
  linkAuthUser: requireRole(["ADMIN", "DIR"])
    .input(z.object({ personalId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const estab = resolveEstablecimiento(ctx);

      // Verificar que el personal exista en el establecimiento.
      const target = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM ece.personal_salud
        WHERE id = ${input.personalId}::uuid AND establecimiento_id = ${estab}::uuid
        LIMIT 1
      `;
      if (!target[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Profesional no encontrado." });
      }

      // Verificar que el User exista y no esté ya vinculado a otro personal.
      const userExists = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, active: true },
      });
      if (!userExists) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuario HIS no encontrado." });
      }

      const alreadyLinked = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM ece.personal_salud
        WHERE auth_user_id = ${input.userId}::uuid AND id <> ${input.personalId}::uuid
        LIMIT 1
      `;
      if (alreadyLinked[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "El usuario ya está vinculado a otro profesional de salud.",
        });
      }

      await ctx.prisma.$executeRaw`
        UPDATE ece.personal_salud
        SET auth_user_id = ${input.userId}::uuid
        WHERE id = ${input.personalId}::uuid
      `;

      return { id: input.personalId, userEmail: userExists.email };
    }),

  /** Desvincula la cuenta de acceso. No borra el User HIS — solo el link. */
  unlinkAuthUser: requireRole(["ADMIN", "DIR"])
    .input(z.object({ personalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const estab = resolveEstablecimiento(ctx);

      const target = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM ece.personal_salud
        WHERE id = ${input.personalId}::uuid AND establecimiento_id = ${estab}::uuid
        LIMIT 1
      `;
      if (!target[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Profesional no encontrado." });
      }

      await ctx.prisma.$executeRaw`
        UPDATE ece.personal_salud
        SET auth_user_id = NULL
        WHERE id = ${input.personalId}::uuid
      `;

      return { id: input.personalId };
    }),

  /**
   * Reporte agregado de un profesional para el rango de fechas dado:
   *   - Total de pacientes únicos.
   *   - Conteos por tipo de encuentro (cirugía / hospitalización / ambulatorio / emergencia).
   *   - Total facturado (Invoice.totalAmount) cuando el encuentro está vinculado.
   *   - Productividad mensual (12 meses retrocedidos desde fechaHasta o hoy).
   *
   * Requiere `auth_user_id` vinculado — sin eso devuelve estado neutral.
   */
  getReporteMedico: tenantProcedure
    .input(
      z.object({
        personalId: z.string().uuid(),
        fechaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        fechaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const estab = resolveEstablecimiento(ctx);
      const orgId = ctx.tenant.organizationId;

      const personal = await ctx.prisma.$queryRaw<{ auth_user_id: string | null }[]>`
        SELECT auth_user_id::text FROM ece.personal_salud
        WHERE id = ${input.personalId}::uuid AND establecimiento_id = ${estab}::uuid
        LIMIT 1
      `;
      if (!personal[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Profesional no encontrado." });
      }
      if (!personal[0].auth_user_id) {
        return {
          authUserLinked: false as const,
          totales: {
            pacientesUnicos: 0,
            cirugia: 0,
            hospitalizacion: 0,
            ambulatorio: 0,
            emergencia: 0,
            facturadoTotal: 0,
            facturadoCobrado: 0,
          },
          mensual: [],
        };
      }
      const userId = personal[0].auth_user_id;
      const desde = input.fechaDesde ?? null;
      const hasta = input.fechaHasta ?? null;

      // Conteos consolidados.
      const [totalRow] = await ctx.prisma.$queryRaw<
        Array<{
          pacientes_unicos: number;
          n_cirugia: number;
          n_hospitalizacion: number;
          n_ambulatorio: number;
          n_emergencia: number;
        }>
      >`
        WITH eventos AS (
          SELECT ia."patientId" AS patient_id, 'hospitalizacion'::text AS tipo
          FROM public."InpatientAdmission" ia
          WHERE ia."attendingId" = ${userId}::uuid AND ia."organizationId" = ${orgId}::uuid
            AND (${desde}::date IS NULL OR ia."admittedAt"::date >= ${desde}::date)
            AND (${hasta}::date IS NULL OR ia."admittedAt"::date <= ${hasta}::date)
          UNION ALL
          SELECT sc."patientId", 'cirugia'
          FROM public."SurgeryCase" sc
          WHERE sc."primarySurgeonId" = ${userId}::uuid AND sc."organizationId" = ${orgId}::uuid
            AND (${desde}::date IS NULL OR sc."scheduledStart"::date >= ${desde}::date)
            AND (${hasta}::date IS NULL OR sc."scheduledStart"::date <= ${hasta}::date)
          UNION ALL
          SELECT oa."patientId", 'ambulatorio'
          FROM public."OutpatientAppointment" oa
          WHERE oa."providerId" = ${userId}::uuid AND oa."organizationId" = ${orgId}::uuid
            AND (${desde}::date IS NULL OR oa."scheduledAt"::date >= ${desde}::date)
            AND (${hasta}::date IS NULL OR oa."scheduledAt"::date <= ${hasta}::date)
          UNION ALL
          SELECT ev."patientId", 'emergencia'
          FROM public."EmergencyVisit" ev
          WHERE ev."treatingId" = ${userId}::uuid AND ev."organizationId" = ${orgId}::uuid
            AND (${desde}::date IS NULL OR ev."arrivedAt"::date >= ${desde}::date)
            AND (${hasta}::date IS NULL OR ev."arrivedAt"::date <= ${hasta}::date)
        )
        SELECT
          COUNT(DISTINCT patient_id)::int AS pacientes_unicos,
          COUNT(*) FILTER (WHERE tipo = 'cirugia')::int AS n_cirugia,
          COUNT(*) FILTER (WHERE tipo = 'hospitalizacion')::int AS n_hospitalizacion,
          COUNT(*) FILTER (WHERE tipo = 'ambulatorio')::int AS n_ambulatorio,
          COUNT(*) FILTER (WHERE tipo = 'emergencia')::int AS n_emergencia
        FROM eventos
      `;

      // Facturación: Invoice cuyo encounterId pertenece a un episodio del médico.
      const [factRow] = await ctx.prisma.$queryRaw<
        Array<{ facturado_total: string; facturado_cobrado: string }>
      >`
        WITH encuentros_medico AS (
          SELECT DISTINCT ia."encounterId" AS encounter_id
          FROM public."InpatientAdmission" ia
          WHERE ia."attendingId" = ${userId}::uuid AND ia."organizationId" = ${orgId}::uuid
          UNION
          SELECT DISTINCT sc."encounterId"
          FROM public."SurgeryCase" sc
          WHERE sc."primarySurgeonId" = ${userId}::uuid AND sc."organizationId" = ${orgId}::uuid
          UNION
          SELECT DISTINCT oa."encounterId"
          FROM public."OutpatientAppointment" oa
          WHERE oa."providerId" = ${userId}::uuid AND oa."organizationId" = ${orgId}::uuid
            AND oa."encounterId" IS NOT NULL
          UNION
          SELECT DISTINCT ev."encounterId"
          FROM public."EmergencyVisit" ev
          WHERE ev."treatingId" = ${userId}::uuid AND ev."organizationId" = ${orgId}::uuid
        )
        SELECT
          COALESCE(SUM(i."totalAmount"), 0)::text AS facturado_total,
          COALESCE(SUM(i."paidAmount"),  0)::text AS facturado_cobrado
        FROM public."Invoice" i
        JOIN encuentros_medico em ON em.encounter_id = i."encounterId"
        WHERE i."organizationId" = ${orgId}::uuid
          AND (${desde}::date IS NULL OR i."issuedAt"::date >= ${desde}::date)
          AND (${hasta}::date IS NULL OR i."issuedAt"::date <= ${hasta}::date)
      `;

      // Productividad mensual: 12 meses retrocedidos.
      const mensual = await ctx.prisma.$queryRaw<
        Array<{ mes: string; cirugia: number; otros: number }>
      >`
        WITH meses AS (
          SELECT generate_series(
            date_trunc('month', (COALESCE(${hasta}::date, CURRENT_DATE) - INTERVAL '11 months')),
            date_trunc('month', COALESCE(${hasta}::date, CURRENT_DATE)),
            INTERVAL '1 month'
          )::date AS mes
        ),
        eventos AS (
          SELECT date_trunc('month', sc."scheduledStart")::date AS mes, 'cirugia'::text AS tipo
          FROM public."SurgeryCase" sc
          WHERE sc."primarySurgeonId" = ${userId}::uuid AND sc."organizationId" = ${orgId}::uuid
          UNION ALL
          SELECT date_trunc('month', ia."admittedAt")::date, 'otros'
          FROM public."InpatientAdmission" ia
          WHERE ia."attendingId" = ${userId}::uuid AND ia."organizationId" = ${orgId}::uuid
          UNION ALL
          SELECT date_trunc('month', oa."scheduledAt")::date, 'otros'
          FROM public."OutpatientAppointment" oa
          WHERE oa."providerId" = ${userId}::uuid AND oa."organizationId" = ${orgId}::uuid
          UNION ALL
          SELECT date_trunc('month', ev."arrivedAt")::date, 'otros'
          FROM public."EmergencyVisit" ev
          WHERE ev."treatingId" = ${userId}::uuid AND ev."organizationId" = ${orgId}::uuid
        )
        SELECT
          to_char(m.mes, 'YYYY-MM') AS mes,
          COUNT(*) FILTER (WHERE e.tipo = 'cirugia' AND e.mes = m.mes)::int AS cirugia,
          COUNT(*) FILTER (WHERE e.tipo = 'otros'   AND e.mes = m.mes)::int AS otros
        FROM meses m
        LEFT JOIN eventos e ON e.mes = m.mes
        GROUP BY m.mes
        ORDER BY m.mes ASC
      `;

      return {
        authUserLinked: true as const,
        totales: {
          pacientesUnicos: totalRow?.pacientes_unicos ?? 0,
          cirugia: totalRow?.n_cirugia ?? 0,
          hospitalizacion: totalRow?.n_hospitalizacion ?? 0,
          ambulatorio: totalRow?.n_ambulatorio ?? 0,
          emergencia: totalRow?.n_emergencia ?? 0,
          facturadoTotal: Number(factRow?.facturado_total ?? "0"),
          facturadoCobrado: Number(factRow?.facturado_cobrado ?? "0"),
        },
        mensual: mensual.map((r) => ({
          mes: r.mes,
          cirugia: r.cirugia,
          otros: r.otros,
        })),
      };
    }),

  /**
   * Crear User HIS + vincular al profesional en una operación atómica.
   * Útil para el flujo "Crear nueva cuenta" desde el dialog de vinculación.
   *
   * Crea: public."User" + public."UserOrganizationRole" (rol opcional) +
   * UPDATE ece.personal_salud.auth_user_id.
   *
   * Idempotencia: si el email ya existe → CONFLICT.
   */
  createAndLinkUser: requireRole(["ADMIN", "DIR"])
    .input(
      z.object({
        personalId: z.string().uuid(),
        email: z.string().email().max(254),
        fullName: z.string().trim().min(3).max(200),
        roleCode: z.string().min(1).max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const estab = resolveEstablecimiento(ctx);
      const orgId = ctx.tenant.organizationId;

      const target = await ctx.prisma.$queryRaw<{ id: string; auth_user_id: string | null }[]>`
        SELECT id::text, auth_user_id::text FROM ece.personal_salud
        WHERE id = ${input.personalId}::uuid AND establecimiento_id = ${estab}::uuid
        LIMIT 1
      `;
      if (!target[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Profesional no encontrado." });
      }
      if (target[0].auth_user_id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Este profesional ya tiene una cuenta vinculada — desvincúlala primero.",
        });
      }

      const emailLower = input.email.toLowerCase();
      const existingUser = await ctx.prisma.user.findUnique({
        where: { email: emailLower },
        select: { id: true },
      });
      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe un usuario con ese correo. Usa 'Vincular existente'.",
        });
      }

      const role = input.roleCode
        ? await ctx.prisma.role.findFirst({
            where: {
              code: input.roleCode,
              OR: [{ organizationId: null }, { organizationId: orgId }],
              active: true,
            },
            select: { id: true },
          })
        : null;
      if (input.roleCode && !role) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Rol RBAC '${input.roleCode}' no existe en esta organización.`,
        });
      }

      const created = await ctx.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: emailLower,
            fullName: input.fullName,
            active: true,
            mfaEnabled: false,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          },
          select: { id: true, email: true, fullName: true },
        });
        if (role) {
          await tx.userOrganizationRole.create({
            data: {
              userId: user.id,
              organizationId: orgId,
              roleId: role.id,
              validFrom: new Date(),
            },
          });
        }
        await tx.$executeRaw`
          UPDATE ece.personal_salud
          SET auth_user_id = ${user.id}::uuid
          WHERE id = ${input.personalId}::uuid
        `;
        return user;
      });

      return { userId: created.id, email: created.email, fullName: created.fullName };
    }),

  /**
   * Búsqueda de Users HIS para vincular (autocomplete del dialog "Vincular cuenta").
   * Filtra por email/fullName y excluye usuarios ya vinculados a otro personal.
   */
  searchAvailableUsers: tenantProcedure
    .input(z.object({ search: z.string().min(2).max(200), limit: z.number().int().min(1).max(20).default(10) }))
    .query(async ({ ctx, input }) => {
      const pattern = `%${input.search.trim()}%`;
      const users = await ctx.prisma.$queryRaw<
        { id: string; email: string; full_name: string }[]
      >`
        SELECT u.id::text, u.email, u."fullName" AS full_name
        FROM public."User" u
        WHERE u.active = true
          AND (u.email ILIKE ${pattern}::text OR u."fullName" ILIKE ${pattern}::text)
          AND NOT EXISTS (
            SELECT 1 FROM ece.personal_salud p WHERE p.auth_user_id = u.id
          )
        ORDER BY u."fullName" ASC
        LIMIT ${input.limit}
      `;
      return users.map((u) => ({ id: u.id, email: u.email, fullName: u.full_name }));
    }),
});
