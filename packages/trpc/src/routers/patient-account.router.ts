/**
 * CC-0002 §7 — Cuentas y Servicios de Paciente.
 *
 * PatientAccount: correlativo CTA00001 por expediente (por patientId).
 * PatientAccountService: tipo HOSPITALARIO | NO_HOSPITALARIO.
 * encounterId es opcional en ambos — un paciente ambulatorio puede generar
 * una cuenta sin admisión asociada.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";
import { nextCuenta } from "../lib/cuenta-numbering";

const tipoServicioEnum = z.enum(["HOSPITALARIO", "NO_HOSPITALARIO"]);

export const patientAccountRouter = router({
  /**
   * Crea una nueva cuenta para un paciente.
   * Genera el correlativo CTA{NNNNN} de forma atómica vía fn_next_cuenta.
   */
  crear: tenantProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const numeroCuenta = await nextCuenta(tx, input.patientId);
        return tx.patientAccount.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            patientId: input.patientId,
            encounterId: input.encounterId ?? null,
            numeroCuenta,
            createdBy: ctx.user.id,
          },
        });
      });
    }),

  /**
   * Agrega un servicio a una cuenta existente.
   */
  agregarServicio: tenantProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        tipo: tipoServicioEnum,
        descripcion: z.string().max(300).optional(),
        encounterId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.patientAccountService.create({
          data: {
            accountId: input.accountId,
            tipo: input.tipo,
            descripcion: input.descripcion ?? null,
            encounterId: input.encounterId ?? null,
            createdBy: ctx.user.id,
          },
        });
      });
    }),

  /**
   * Lista cuentas de un paciente con sus servicios incluidos.
   */
  listarPorPaciente: tenantProcedure
    .input(z.object({ patientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.patientAccount.findMany({
          where: {
            patientId: input.patientId,
            organizationId: ctx.tenant.organizationId,
          },
          include: { servicios: true },
          orderBy: { numeroCuenta: "asc" },
        });
      });
    }),
});
