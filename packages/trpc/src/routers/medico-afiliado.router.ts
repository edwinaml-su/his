/**
 * Router tRPC — Médicos Afiliados (CC-0036 Ola 1B, REQ-HIS-AFIL-001 US.AFIL.1.2).
 *
 * `MedicoAfiliado` es una entidad de negocio (contraparte económica), NO un
 * `User` (D5 del REQ): `userId` es opcional. RBAC vía `requirePermission`
 * sobre el recurso "medico_afiliado" (sql/244 siembra Permission/
 * RolePermission para ADMIN, DIR y ADMIN_CONSULTORIOS; MEDICO_AFILIADO solo
 * lee).
 *
 * Pendiente documentado (Ola 2+, NO implementado acá):
 *   - `activar` (PROSPECTO→ACTIVO): el REQ exige contrato de arrendamiento o
 *     convenio de honorarios VIGENTE. CC-0036 Ola 2 cerró el lado de
 *     contrato — `contrato.router.ts#activar` promueve automáticamente al
 *     afiliado PROSPECTO→ACTIVO cuando su `ContratoArrendamiento` pasa a
 *     VIGENTE. Esta mutación (`activar` de este router) queda como la vía
 *     MANUAL restante — gateada solo por `medico_afiliado.editar` + auditoría
 *     (trigger `trg_audit_MedicoAfiliado`, sql/244) — para el caso
 *     `ConvenioHonorario` VIGENTE, que llega en una ola posterior
 *     (honorarios). Decisión temporal explícita, no un olvido.
 *   - `darBaja`: el REQ exige verificar ausencia de producción PENDIENTE sin
 *     liquidar y de contrato VIGENTE. `ProduccionMedica` no existe todavía
 *     (ola de honorarios); `ContratoArrendamiento` sí existe desde Ola 2 pero
 *     el chequeo de "sin contrato VIGENTE" no se agregó aquí para no acoplar
 *     esta ola a la de honorarios a medias — se cierra completo cuando
 *     ProduccionMedica exista.
 *   - ABAC `$user.medicoAfiliadoId` (REQ §7.3.1, SECRETARIA_MEDICO_AFILIADO /
 *     MEDICO_AFILIADO): requiere resolver `medicoAfiliadoId` en
 *     `getTenantContext()` (apps/web/src/lib/auth/session.ts) y añadirlo a
 *     `TenantContext`. Se dejó DELIBERADAMENTE fuera de esta ola — ese
 *     helper es `cache()`-envuelto y central a TODA request autenticada
 *     (52+ consumidores del tipo `TenantContext`); tocarlo sin el resto del
 *     portal del afiliado (agenda/liquidaciones propias) que consume el
 *     campo es riesgo sin beneficio inmediato. `vincularUsuario` de abajo
 *     deja el dato (`MedicoAfiliado.userId`) listo para cuando esa ola
 *     resuelva la lectura.
 *   - Sync a Odoo (`res.partner`, REQ §9): política READ-ONLY vigente
 *     (`feedback_integraciones_externas_readonly`). Escritura a Odoo queda
 *     para la ola de contratos, con autorización explícita de Edwin.
 */
import { TRPCError } from "@trpc/server";
import { Prisma, emitDomainEvent } from "@his/database";
import {
  medicoAfiliadoListSchema,
  medicoAfiliadoCreateSchema,
  medicoAfiliadoUpdateSchema,
  medicoAfiliadoActivarSchema,
  medicoAfiliadoDarBajaSchema,
  medicoAfiliadoVincularUsuarioSchema,
} from "@his/contracts";
import { router, requirePermission } from "../trpc";
import { withTenantContext } from "../rls-context";

const includeEspecialidades = {
  especialidadPrincipal: { select: { id: true, code: true, name: true } },
  especialidades: {
    include: { specialty: { select: { id: true, code: true, name: true } } },
  },
} as const;

/**
 * El `findFirst` previo en `create` reduce la ventana pero no la cierra
 * (TOCTOU): dos altas concurrentes con el mismo JVPM pueden pasar el
 * pre-check antes de que cualquiera inserte. La unicidad real la garantiza
 * `MedicoAfiliado_organizationId_jvpmNumero_key` (sql/244) — este catch
 * traduce esa última línea de defensa al mismo CONFLICT es-SV del pre-check
 * en vez de dejar pasar un 500 genérico.
 */
function rethrowUniqueJvpm(err: unknown, jvpmNumero: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Ya existe un médico afiliado con JVPM ${jvpmNumero} en esta organización.`,
    });
  }
  throw err;
}

export const medicoAfiliadoRouter = router({
  /** Lista los médicos afiliados de la org del tenant, con filtros opcionales. */
  list: requirePermission("medico_afiliado.leer")
    .input(medicoAfiliadoListSchema)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.medicoAfiliado.findMany({
          where: {
            organizationId: tenant.organizationId,
            ...(input?.estado ? { estado: input.estado } : {}),
            ...(input?.tipoRelacion ? { tipoRelacion: input.tipoRelacion } : {}),
            ...(input?.search
              ? {
                  OR: [
                    { nombreCompleto: { contains: input.search, mode: "insensitive" } },
                    { jvpmNumero: { contains: input.search, mode: "insensitive" } },
                  ],
                }
              : {}),
          },
          include: includeEspecialidades,
          orderBy: { nombreCompleto: "asc" },
        }),
      );
    }),

  get: requirePermission("medico_afiliado.leer")
    .input(medicoAfiliadoActivarSchema)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const afiliado = await withTenantContext(prisma, tenant, (tx) =>
        tx.medicoAfiliado.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          include: includeEspecialidades,
        }),
      );
      if (!afiliado) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Médico afiliado no encontrado." });
      }
      return afiliado;
    }),

  /**
   * Alta de médico afiliado (US.AFIL.1.2 AC1/AC2). Queda en PROSPECTO y
   * emite `afiliado.creado`. JVPM duplicado en la organización → CONFLICT,
   * ofreciendo el id del registro existente para abrirlo (AC2).
   */
  create: requirePermission("medico_afiliado.crear")
    .input(medicoAfiliadoCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.medicoAfiliado.findFirst({
          where: { organizationId: tenant.organizationId, jvpmNumero: input.jvpmNumero },
          select: { id: true },
        });
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              `Ya existe un médico afiliado con JVPM ${input.jvpmNumero} en esta organización ` +
              `(abrir registro existente: /afiliados/${existing.id}).`,
          });
        }

        const specialtyIds = new Set<string>(input.especialidadIds ?? []);
        if (input.especialidadPrincipalId) specialtyIds.add(input.especialidadPrincipalId);

        let afiliado;
        try {
          afiliado = await tx.medicoAfiliado.create({
            data: {
              organizationId: tenant.organizationId,
              nombreCompleto: input.nombreCompleto,
              tipoDocumentoId: input.tipoDocumentoId ?? null,
              numeroDocumento: input.numeroDocumento ?? null,
              jvpmNumero: input.jvpmNumero,
              especialidadPrincipalId: input.especialidadPrincipalId ?? null,
              tipoRelacion: input.tipoRelacion,
              nit: input.nit ?? null,
              nrc: input.nrc ?? null,
              esContribuyenteIva: input.esContribuyenteIva ?? false,
              estado: "PROSPECTO",
              fechaIngreso: input.fechaIngreso ? new Date(input.fechaIngreso) : null,
              permiteCompensacion: input.permiteCompensacion ?? true,
              createdBy: user.id,
              updatedBy: user.id,
              ...(specialtyIds.size > 0
                ? {
                    especialidades: {
                      create: Array.from(specialtyIds).map((specialtyId) => ({
                        specialtyId,
                        esPrincipal: specialtyId === input.especialidadPrincipalId,
                      })),
                    },
                  }
                : {}),
            },
            include: includeEspecialidades,
          });
        } catch (err) {
          rethrowUniqueJvpm(err, input.jvpmNumero);
        }

        await emitDomainEvent(tx, {
          organizationId: tenant.organizationId,
          eventType: "afiliado.creado",
          aggregateType: "MedicoAfiliado",
          aggregateId: afiliado.id,
          emittedById: user.id,
          payload: {
            medicoAfiliadoId: afiliado.id,
            nombreCompleto: afiliado.nombreCompleto,
            jvpmNumero: afiliado.jvpmNumero,
            tipoRelacion: afiliado.tipoRelacion as
              | "AFILIADO_ARRENDATARIO"
              | "AFILIADO_SIN_CONSULTORIO"
              | "STAFF_INTERNO",
            estado: "PROSPECTO",
          },
        });

        return afiliado;
      });
    }),

  /** Edita datos generales del afiliado (no JVPM ni estado). */
  update: requirePermission("medico_afiliado.editar")
    .input(medicoAfiliadoUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.medicoAfiliado.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Médico afiliado no encontrado." });
        }
        return tx.medicoAfiliado.update({
          where: { id: input.id },
          data: {
            ...(input.nombreCompleto !== undefined ? { nombreCompleto: input.nombreCompleto } : {}),
            ...(input.tipoDocumentoId !== undefined ? { tipoDocumentoId: input.tipoDocumentoId } : {}),
            ...(input.numeroDocumento !== undefined ? { numeroDocumento: input.numeroDocumento } : {}),
            ...(input.especialidadPrincipalId !== undefined
              ? { especialidadPrincipalId: input.especialidadPrincipalId }
              : {}),
            ...(input.nit !== undefined ? { nit: input.nit } : {}),
            ...(input.nrc !== undefined ? { nrc: input.nrc } : {}),
            ...(input.esContribuyenteIva !== undefined
              ? { esContribuyenteIva: input.esContribuyenteIva }
              : {}),
            ...(input.fechaIngreso !== undefined
              ? { fechaIngreso: input.fechaIngreso ? new Date(input.fechaIngreso) : null }
              : {}),
            ...(input.permiteCompensacion !== undefined
              ? { permiteCompensacion: input.permiteCompensacion }
              : {}),
            updatedBy: user.id,
          },
          include: includeEspecialidades,
        });
      });
    }),

  /**
   * PROSPECTO → ACTIVO (US.AFIL.1.2 AC3). Decisión temporal Ola 1B: el gate
   * real (contrato o convenio VIGENTE) no puede implementarse porque esas
   * tablas no existen todavía — ver docstring del router. Queda auditado
   * (trigger de BD) y detrás de `medico_afiliado.editar`.
   */
  activar: requirePermission("medico_afiliado.editar")
    .input(medicoAfiliadoActivarSchema)
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.medicoAfiliado.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          select: { id: true, estado: true },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Médico afiliado no encontrado." });
        }
        if (existing.estado !== "PROSPECTO") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El afiliado está en estado ${existing.estado}, no se puede activar desde ahí.`,
          });
        }
        return tx.medicoAfiliado.update({
          where: { id: input.id },
          data: { estado: "ACTIVO", updatedBy: user.id },
        });
      });
    }),

  /**
   * ACTIVO → INACTIVO (US.AFIL.1.2 AC4). Exige fecha y motivo de baja.
   * TODO CC-0036 Ola 2: verificar ausencia de `ProduccionMedica` PENDIENTE y
   * de `ContratoArrendamiento` VIGENTE antes de permitir la baja — esas
   * tablas no existen todavía en esta ola.
   */
  darBaja: requirePermission("medico_afiliado.dar_baja")
    .input(medicoAfiliadoDarBajaSchema)
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.medicoAfiliado.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          select: { id: true, estado: true },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Médico afiliado no encontrado." });
        }
        if (existing.estado !== "ACTIVO") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El afiliado está en estado ${existing.estado}, solo se da de baja desde ACTIVO.`,
          });
        }
        return tx.medicoAfiliado.update({
          where: { id: input.id },
          data: {
            estado: "INACTIVO",
            fechaBaja: new Date(input.fechaBaja),
            motivoBaja: input.motivoBaja,
            updatedBy: user.id,
          },
        });
      });
    }),

  /**
   * Vincula el afiliado a un `User` existente del HIS (US.AFIL.1.2 AC5).
   * NO resuelve `medicoAfiliadoId` en el contexto ABAC de sesión todavía
   * (ver docstring del router) — solo persiste el enlace.
   */
  vincularUsuario: requirePermission("medico_afiliado.editar")
    .input(medicoAfiliadoVincularUsuarioSchema)
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.medicoAfiliado.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Médico afiliado no encontrado." });
        }

        // El usuario a vincular debe tener membresía vigente en la misma
        // organización del tenant — sin este chequeo, `vincularUsuario`
        // podía enlazar un `userId` de cualquier otra organización (IDOR).
        const membership = await tx.userOrganizationRole.findFirst({
          where: { userId: input.userId, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!membership) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "El usuario no tiene membresía en esta organización.",
          });
        }

        return tx.medicoAfiliado.update({
          where: { id: input.id },
          data: { userId: input.userId, updatedBy: user.id },
        });
      });
    }),
});
