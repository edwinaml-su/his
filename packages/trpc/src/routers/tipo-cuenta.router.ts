/**
 * Router tRPC: Tipo de Cuenta del paciente (CC-0015) — pivote de lista de precios.
 *
 * TipoCuenta SÍ tiene modelo Prisma (a diferencia de ServicePriceList/Invoice,
 * que son drift). El join con "ServicePriceList" (tabla fuera de Prisma) para
 * mostrar el nombre de la lista asignada se resuelve con $queryRawUnsafe.
 *
 * RBAC: lecturas con tenantProcedure; escrituras con ADMIN o ACCOUNTANT
 * (mismo patrón que servicePriceListRouter).
 */
import { TRPCError } from "@trpc/server";
import {
  tipoCuentaListInput,
  tipoCuentaCreateInput,
  tipoCuentaUpdateInput,
  tipoCuentaSetActiveInput,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

interface PriceListNameRow {
  id: string;
  name: string;
}

/** Tipo mínimo del cliente de transacción que necesitan los helpers de este router. */
type TxForPriceListCheck = {
  $queryRawUnsafe: <T>(query: string, ...values: unknown[]) => Promise<T>;
};

async function assertPriceListBelongsToTenant(
  tx: TxForPriceListCheck,
  priceListId: string,
  organizationId: string,
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "ServicePriceList" WHERE id = $1 AND "organizationId" = $2`,
    priceListId,
    organizationId,
  );
  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lista de precios no encontrada." });
  }
}

const readerProc = tenantProcedure;
const writerProc = requireRole(["ADMIN", "ACCOUNTANT"]);

export const tipoCuentaRouter = router({
  /**
   * Lista tipos de cuenta del tenant con el nombre de la lista de precios asignada.
   */
  list: readerProc.input(tipoCuentaListInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const tipos = await tx.tipoCuenta.findMany({
        where: {
          organizationId: tenant.organizationId,
          ...(input?.activeOnly ? { active: true } : {}),
        },
        orderBy: [{ esParticular: "desc" }, { nombre: "asc" }],
      });

      const priceListIds = [
        ...new Set(tipos.map((t) => t.priceListId).filter((id): id is string => !!id)),
      ];

      const priceListNames: Record<string, string> =
        priceListIds.length === 0
          ? {}
          : Object.fromEntries(
              (
                await tx.$queryRawUnsafe<PriceListNameRow[]>(
                  `SELECT id, name FROM "ServicePriceList" WHERE id = ANY($1::uuid[])`,
                  priceListIds,
                )
              ).map((r) => [r.id, r.name]),
            );

      return tipos.map((t) => ({
        ...t,
        priceListName: t.priceListId ? (priceListNames[t.priceListId] ?? null) : null,
      }));
    });
  }),

  /**
   * Crea un tipo de cuenta. Valida que priceListId (si viene) pertenezca al tenant.
   */
  create: writerProc.input(tipoCuentaCreateInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      if (input.priceListId) {
        await assertPriceListBelongsToTenant(tx, input.priceListId, tenant.organizationId);
      }

      const existing = await tx.tipoCuenta.findFirst({
        where: { organizationId: tenant.organizationId, code: input.code },
      });
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Ya existe un tipo de cuenta con código "${input.code}".`,
        });
      }

      return tx.tipoCuenta.create({
        data: {
          organizationId: tenant.organizationId,
          code: input.code,
          nombre: input.nombre,
          priceListId: input.priceListId ?? null,
          insurerId: input.insurerId ?? null,
          esParticular: input.esParticular,
          createdBy: ctx.user.id,
        },
      });
    });
  }),

  /**
   * Edita un tipo de cuenta existente.
   */
  update: writerProc.input(tipoCuentaUpdateInput).mutation(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const tipo = await tx.tipoCuenta.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
      });
      if (!tipo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tipo de cuenta no encontrado." });
      }

      if (input.priceListId) {
        await assertPriceListBelongsToTenant(tx, input.priceListId, tenant.organizationId);
      }

      return tx.tipoCuenta.update({
        where: { id: input.id },
        data: {
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
          ...(input.priceListId !== undefined ? { priceListId: input.priceListId } : {}),
          ...(input.insurerId !== undefined ? { insurerId: input.insurerId } : {}),
          ...(input.esParticular !== undefined ? { esParticular: input.esParticular } : {}),
          updatedBy: ctx.user.id,
        },
      });
    });
  }),

  /**
   * Desactiva un tipo de cuenta (no se elimina — las cuentas ya creadas lo conservan).
   */
  deactivate: writerProc
    .input(tipoCuentaSetActiveInput.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const tipo = await tx.tipoCuenta.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!tipo) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tipo de cuenta no encontrado." });
        }
        return tx.tipoCuenta.update({
          where: { id: input.id },
          data: { active: false, updatedBy: ctx.user.id },
        });
      });
    }),

  /**
   * Reactiva un tipo de cuenta.
   */
  reactivate: writerProc
    .input(tipoCuentaSetActiveInput.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const tipo = await tx.tipoCuenta.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!tipo) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tipo de cuenta no encontrado." });
        }
        return tx.tipoCuenta.update({
          where: { id: input.id },
          data: { active: true, updatedBy: ctx.user.id },
        });
      });
    }),
});
