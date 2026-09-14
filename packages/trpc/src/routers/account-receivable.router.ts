/**
 * CC-0027 — Cuentas por Cobrar (ruta B del alta administrativa).
 *
 * `AccountReceivable` se crea desde `patientAccount.altaAdministrativa`
 * (ruta CXC) — este router es el worklist de cobros: listado por estado y
 * registro de abonos. `registrarAbono` NO toca `PatientAccount` (la cuenta
 * ya está CERRADA cuando existe una CxC) — solo reduce `saldoActual` y pasa
 * a PAGADA cuando llega a 0.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

const writerProc = requireRole(["ADMIN", "ACCOUNTANT"]);

/** Saldo se considera liquidado por debajo de este umbral (redondeo de centavos). */
const SALDO_EPSILON = 0.005;

export const accountReceivableRouter = router({
  list: tenantProcedure
    .input(
      z
        .object({ estado: z.enum(["ABIERTA", "PAGADA", "INCOBRABLE"]).optional() })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) =>
        tx.accountReceivable.findMany({
          where: {
            organizationId: ctx.tenant.organizationId,
            ...(input?.estado ? { estado: input.estado } : {}),
          },
          include: {
            account: {
              select: {
                id: true,
                numeroCuenta: true,
                patientId: true,
                patient: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
      );
    }),

  registrarAbono: writerProc
    .input(
      z.object({
        id: z.string().uuid(),
        monto: z.number().positive(),
        notas: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const cxc = await tx.accountReceivable.findFirst({
          where: { id: input.id, organizationId: ctx.tenant.organizationId },
        });
        if (!cxc) {
          throw new TRPCError({ code: "NOT_FOUND", message: "CxC no encontrada." });
        }
        if (cxc.estado !== "ABIERTA") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Solo una CxC ABIERTA acepta abonos (estado actual: ${cxc.estado}).`,
          });
        }

        const nuevoSaldo = Number(cxc.saldoActual) - input.monto;
        if (nuevoSaldo < -SALDO_EPSILON) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `El abono ($${input.monto.toFixed(2)}) excede el saldo pendiente ($${Number(cxc.saldoActual).toFixed(2)}).`,
          });
        }
        const saldoFinal = Math.max(nuevoSaldo, 0);

        return tx.accountReceivable.update({
          where: { id: cxc.id },
          data: {
            saldoActual: saldoFinal,
            estado: saldoFinal <= SALDO_EPSILON ? "PAGADA" : "ABIERTA",
            notas: input.notas
              ? cxc.notas
                ? `${cxc.notas}\n${input.notas}`
                : input.notas
              : cxc.notas,
            updatedBy: ctx.user.id,
          },
        });
      });
    }),
});
