/**
 * Router tRPC — Consultorios (CC-0036 Ola 1B, REQ-HIS-AFIL-001 US.AFIL.1.1).
 *
 * Catálogo de consultorios por sede, arrendables o propios. Mismo patrón que
 * `room.router.ts`: `withTenantContext` (contrato RLS) en cada procedure.
 * RBAC vía `requirePermission` sobre el recurso "consultorio" (sql/244
 * siembra Permission/RolePermission para ADMIN, DIR y ADMIN_CONSULTORIOS).
 *
 * QA/E2E: cubrir alta con código duplicado (CONFLICT es-SV), filtro por
 * sede (RLS + `establishmentId`), y que un usuario sin `consultorio.leer`
 * reciba 403 (test unitario en __tests__/consultorio.router.test.ts).
 */
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import {
  consultorioListSchema,
  consultorioCreateSchema,
  consultorioUpdateSchema,
  consultorioSetActiveSchema,
} from "@his/contracts";
import { router, requirePermission } from "../trpc";
import { withTenantContext } from "../rls-context";

function rethrowUniqueCodigo(err: unknown, codigo: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Ya existe un consultorio con el código ${codigo} en esta organización.`,
    });
  }
  throw err;
}

export const consultorioRouter = router({
  /** Lista los consultorios de la org del tenant, con filtro opcional por sede. */
  list: requirePermission("consultorio.leer")
    .input(consultorioListSchema)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.consultorio.findMany({
          where: {
            organizationId: tenant.organizationId,
            ...(input?.establishmentId ? { establishmentId: input.establishmentId } : {}),
            ...(input?.serviceUnitId ? { serviceUnitId: input.serviceUnitId } : {}),
            ...(input?.activeOnly ? { active: true } : {}),
          },
          include: {
            establishment: { select: { id: true, code: true, name: true } },
            serviceUnit: { select: { id: true, code: true, name: true } },
            especialidadSugerida: { select: { id: true, code: true, name: true } },
          },
          orderBy: [{ establishmentId: "asc" }, { codigo: "asc" }],
        }),
      );
    }),

  get: requirePermission("consultorio.leer")
    .input(consultorioSetActiveSchema.pick({ id: true }))
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const consultorio = await withTenantContext(prisma, tenant, (tx) =>
        tx.consultorio.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          include: {
            establishment: { select: { id: true, code: true, name: true } },
            serviceUnit: { select: { id: true, code: true, name: true } },
            especialidadSugerida: { select: { id: true, code: true, name: true } },
          },
        }),
      );
      if (!consultorio) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Consultorio no encontrado." });
      }
      return consultorio;
    }),

  /** Crea un consultorio nuevo en la org del tenant (US.AFIL.1.1 AC1). */
  create: requirePermission("consultorio.crear")
    .input(consultorioCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      try {
        return await withTenantContext(prisma, tenant, (tx) =>
          tx.consultorio.create({
            data: {
              organizationId: tenant.organizationId,
              establishmentId: input.establishmentId,
              serviceUnitId: input.serviceUnitId ?? null,
              codigo: input.codigo,
              nombre: input.nombre,
              piso: input.piso ?? null,
              areaM2: input.areaM2 ?? null,
              tipoUso: input.tipoUso,
              especialidadSugeridaId: input.especialidadSugeridaId ?? null,
              capacidadPacientesHora: input.capacidadPacientesHora ?? null,
              glnCodigo: input.glnCodigo ?? null,
              ...(input.equipamiento !== undefined
                ? { equipamiento: input.equipamiento as Prisma.InputJsonValue }
                : {}),
              createdBy: user.id,
              updatedBy: user.id,
            },
          }),
        );
      } catch (err) {
        rethrowUniqueCodigo(err, input.codigo);
      }
    }),

  /** Edita un consultorio existente del tenant (US.AFIL.1.1). */
  update: requirePermission("consultorio.editar")
    .input(consultorioUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.consultorio.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Consultorio no encontrado." });
        }
        return tx.consultorio.update({
          where: { id: input.id },
          data: {
            ...(input.serviceUnitId !== undefined ? { serviceUnitId: input.serviceUnitId } : {}),
            ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
            ...(input.piso !== undefined ? { piso: input.piso } : {}),
            ...(input.areaM2 !== undefined ? { areaM2: input.areaM2 } : {}),
            ...(input.tipoUso !== undefined ? { tipoUso: input.tipoUso } : {}),
            ...(input.especialidadSugeridaId !== undefined
              ? { especialidadSugeridaId: input.especialidadSugeridaId }
              : {}),
            ...(input.capacidadPacientesHora !== undefined
              ? { capacidadPacientesHora: input.capacidadPacientesHora }
              : {}),
            ...(input.glnCodigo !== undefined ? { glnCodigo: input.glnCodigo } : {}),
            ...(input.equipamiento !== undefined
              ? { equipamiento: input.equipamiento as Prisma.InputJsonValue }
              : {}),
            updatedBy: user.id,
          },
        });
      });
    }),

  /**
   * Activa/desactiva un consultorio (US.AFIL.1.1 AC3).
   *
   * CC-0036 Ola 2 (cierra el TODO de Ola 1B): bloquea la desactivación si hay
   * un `ContratoArrendamiento` en estado VIGENTE o EN_MORA sobre este
   * consultorio, indicando el folio que lo bloquea.
   */
  setActive: requirePermission("consultorio.desactivar")
    .input(consultorioSetActiveSchema)
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.consultorio.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          select: { id: true, active: true },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Consultorio no encontrado." });
        }
        if (existing.active === input.active) {
          return existing; // idempotente
        }
        if (!input.active) {
          const contratoBloqueante = await tx.contratoArrendamiento.findFirst({
            where: { consultorioId: input.id, estado: { in: ["VIGENTE", "EN_MORA"] } },
            select: { folio: true },
          });
          if (contratoBloqueante) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `No se puede desactivar: tiene un contrato de arrendamiento vigente (folio ${contratoBloqueante.folio}).`,
            });
          }
        }
        return tx.consultorio.update({
          where: { id: input.id },
          data: { active: input.active, updatedBy: user.id },
        });
      });
    }),
});
