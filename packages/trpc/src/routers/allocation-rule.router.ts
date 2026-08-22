/**
 * Router tRPC: Reglas de prorrateo de centros de costo.
 *
 * Las tablas CostCenterAllocationRule / CostCenterAllocationTarget existen en
 * Supabase prod (sql/131_cost_centers_spec_v2_41.sql) pero no en schema.prisma
 * (schema drift intencional); todas las queries usan $queryRawUnsafe.
 *
 * Invariantes:
 *   - Solo centros tipo "apoyo" (code 3-XXX-XXX) pueden ser source.
 *   - Targets deben ser tipo "productivo" (1-*) o "intermedio" (2-*).
 *   - Sum(percentage) por regla = exactamente 100%.
 *   - UNIQUE(sourceCostCenterId, active=true): una sola regla activa por centro de apoyo.
 *   - deactivate: toggle active=false (no delete).
 *
 * runProration (MVP — PREVIEW, no persiste):
 *   - Fuente de costo: HisOperatingCost si existe, fallback a InvoiceItem si existe, fallback 0.
 *   - Sprint futuro: persistir en tabla ProrationRun para auditoría.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const costDistributionBaseEnum = z.enum([
  "metros_cuadrados",
  "numero_empleados",
  "horas_trabajadas",
  "pacientes_atendidos",
  "kilos_lavados",
  "consumo_directo",
  "porcentaje_manual",
]);

const periodicityEnum = z.enum(["monthly", "quarterly"]);

const targetInput = z.object({
  targetCostCenterId: z.string().uuid(),
  percentage: z.number().min(0.01).max(100),
});

const listInput = z
  .object({
    sourceCostCenterId: z.string().uuid().optional(),
    active: z.boolean().optional(),
  })
  .optional();

const getInput = z.object({ id: z.string().uuid() });

const createInput = z
  .object({
    name: z.string().trim().min(3).max(120),
    sourceCostCenterId: z.string().uuid(),
    base: costDistributionBaseEnum,
    periodicity: periodicityEnum.default("monthly"),
    targets: z.array(targetInput).min(1, "Debe tener al menos un centro destino."),
  })
  .refine(
    (d) => Math.abs(d.targets.reduce((s, t) => s + t.percentage, 0) - 100) < 0.01,
    { message: "La suma de porcentajes debe ser exactamente 100%." },
  );

const updateInput = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(3).max(120).optional(),
    base: costDistributionBaseEnum.optional(),
    periodicity: periodicityEnum.optional(),
    targets: z.array(targetInput).min(1).optional(),
  })
  .refine(
    (d) => {
      if (!d.targets) return true;
      return Math.abs(d.targets.reduce((s, t) => s + t.percentage, 0) - 100) < 0.01;
    },
    { message: "La suma de porcentajes debe ser exactamente 100%." },
  );

const deactivateInput = z.object({ id: z.string().uuid() });

const runProrationInput = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  organizationId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Types (local, para raw query rows)
// ---------------------------------------------------------------------------

type RuleRow = {
  id: string;
  organizationId: string;
  name: string;
  sourceCostCenterId: string;
  sourceCode: string;
  sourceName: string;
  base: string;
  periodicity: string;
  active: boolean;
};

type TargetRow = {
  id: string;
  ruleId: string;
  targetCostCenterId: string;
  targetCode: string;
  targetName: string;
  percentage: string; // Postgres decimal → string en raw query
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Tipo mínimo del cliente Prisma que usamos en helpers (evita importar PrismaClient completo).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawQueryClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Promise<T>;
};

async function assertSourceIsApoyo(
  prisma: RawQueryClient,
  sourceCostCenterId: string,
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tipo: string | null }>>(
    `SELECT tipo FROM "CostCenter" WHERE id = $1`,
    sourceCostCenterId,
  );
  if (!rows.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Centro de costo origen no encontrado." });
  }
  if (rows[0]?.tipo !== "apoyo") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "El centro origen debe ser de tipo 'apoyo'.",
    });
  }
}

async function assertTargetsAreValid(
  prisma: RawQueryClient,
  targetIds: string[],
): Promise<void> {
  if (!targetIds.length) return;
  const placeholders = targetIds.map((_, i) => `$${i + 1}`).join(",");
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; tipo: string | null }>>(
    `SELECT id, tipo FROM "CostCenter" WHERE id IN (${placeholders})`,
    ...targetIds,
  );
  if (rows.length !== targetIds.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Uno o más centros destino no existen." });
  }
  const invalid = rows.filter((r) => r.tipo !== "productivo" && r.tipo !== "intermedio");
  if (invalid.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Centros destino inválidos (deben ser productivo o intermedio): ${invalid.map((r) => r.id).join(", ")}`,
    });
  }
}

async function fetchTargetsForRules(
  prisma: RawQueryClient,
  ruleIds: string[],
): Promise<TargetRow[]> {
  if (!ruleIds.length) return [];
  const ph = ruleIds.map((_, i) => `$${i + 1}`).join(",");
  return prisma.$queryRawUnsafe<TargetRow[]>(
    `SELECT t.id, t."ruleId", t."targetCostCenterId",
            cc.code AS "targetCode", cc.name AS "targetName",
            t.percentage::text AS percentage
     FROM "CostCenterAllocationTarget" t
     JOIN "CostCenter" cc ON cc.id = t."targetCostCenterId"
     WHERE t."ruleId" IN (${ph})
     ORDER BY t.percentage DESC`,
    ...ruleIds,
  );
}

// ---------------------------------------------------------------------------
// Procedure builders
// ---------------------------------------------------------------------------

const readerProc = tenantProcedure;
const writerProc = requireRole(["ADMIN", "ACCOUNTANT"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const allocationRuleRouter = router({
  /**
   * Lista reglas con targets incluidos.
   * Filtros: sourceCostCenterId, active.
   *
   * R02 (auditoría RLS externa) — decisión (a): `CostCenterAllocationRule` y
   * `CostCenterAllocationTarget` tienen policies `alloc_rule_tenant` /
   * `alloc_target_tenant` (ALL commands, `organizationId = current_org_id()`
   * — target vía EXISTS a su rule) y `authenticated` tiene grants completos
   * (verificado en prod 2026-08-22). `withTenantContext` es defensa en
   * profundidad redundante con el filtro JS existente aquí.
   */
  list: readerProc.input(listInput).query(async ({ ctx, input }) => {
    const orgId = ctx.tenant.organizationId;
    const conditions: string[] = [`r."organizationId" = '${orgId}'`];
    if (input?.sourceCostCenterId) {
      conditions.push(`r."sourceCostCenterId" = '${input.sourceCostCenterId}'`);
    }
    if (input?.active !== undefined) {
      conditions.push(`r.active = ${input.active}`);
    }
    const where = conditions.join(" AND ");

    try {
      return await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const rules = await tx.$queryRawUnsafe<RuleRow[]>(
          `SELECT r.id, r."organizationId", r.name,
                  r."sourceCostCenterId",
                  src.code AS "sourceCode", src.name AS "sourceName",
                  r.base, r.periodicity, r.active
           FROM "CostCenterAllocationRule" r
           JOIN "CostCenter" src ON src.id = r."sourceCostCenterId"
           WHERE ${where}
           ORDER BY r.name ASC`,
        );

        if (!rules.length) return [];

        const targets = await fetchTargetsForRules(tx, rules.map((r) => r.id));

        return rules.map((rule) => ({
          ...rule,
          targets: targets
            .filter((t) => t.ruleId === rule.id)
            .map((t) => ({ ...t, percentage: parseFloat(t.percentage) })),
        }));
      });
    } catch {
      // Tabla no existe en entorno dev sin migración
      return [];
    }
  }),

  /**
   * Detalle de una regla con targets.
   *
   * R02: a diferencia de `list`, este procedure NUNCA filtró por tenant en JS
   * (solo `WHERE r.id = $1`) — cualquier usuario autenticado podía leer la
   * regla de prorrateo de OTRA organización adivinando su UUID. `alloc_rule_tenant`
   * cubre SELECT (verificado en prod), así que demotar el rol cierra el IDOR:
   * bajo RLS, un id de otra org simplemente no matchea ninguna fila.
   */
  get: readerProc.input(getInput).query(async ({ ctx, input }) => {
    try {
      return await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const rules = await tx.$queryRawUnsafe<RuleRow[]>(
          `SELECT r.id, r."organizationId", r.name,
                  r."sourceCostCenterId",
                  src.code AS "sourceCode", src.name AS "sourceName",
                  r.base, r.periodicity, r.active
           FROM "CostCenterAllocationRule" r
           JOIN "CostCenter" src ON src.id = r."sourceCostCenterId"
           WHERE r.id = $1`,
          input.id,
        );
        if (!rules.length) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada." });
        }
        const rule = rules[0]!;
        const targets = await fetchTargetsForRules(tx, [input.id]);
        return {
          ...rule,
          targets: targets.map((t) => ({ ...t, percentage: parseFloat(t.percentage) })),
        };
      });
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al leer regla." });
    }
  }),

  /**
   * Crea regla + targets en una transacción.
   * Valida: source=apoyo, targets=productivo|intermedio, sum=100%.
   *
   * R02 — decisión (a): INSERT ya fija `organizationId: orgId` desde
   * `ctx.tenant` (el cliente no puede inyectar otro), pero `withTenantContext`
   * agrega defensa RLS real (`alloc_rule_tenant`/`alloc_target_tenant` cubren
   * INSERT). `assertSourceIsApoyo`/`assertTargetsAreValid` (fuera de esta tx)
   * quedan sin envolver a propósito: son lecturas de validación sobre
   * `CostCenter` por id sin boundary de tenant hoy (gap preexistente de
   * integridad referencial, no de RLS bypass — fuera de alcance de R02).
   */
  create: writerProc.input(createInput).mutation(async ({ ctx, input }) => {
    const orgId = ctx.tenant.organizationId;

    await assertSourceIsApoyo(ctx.prisma, input.sourceCostCenterId);
    await assertTargetsAreValid(
      ctx.prisma,
      input.targets.map((t) => t.targetCostCenterId),
    );

    // Chequeo server-side redundante (Zod refine puede bypassarse en tests directos)
    const serverSum = input.targets.reduce((s, t) => s + t.percentage, 0);
    if (Math.abs(serverSum - 100) >= 0.01) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `La suma de porcentajes es ${serverSum.toFixed(2)}%, debe ser exactamente 100%.`,
      });
    }

    try {
      const result = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const ruleRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `INSERT INTO "CostCenterAllocationRule"
             ("organizationId", name, "sourceCostCenterId", base, periodicity, active)
           VALUES ($1, $2, $3, $4, $5, true)
           RETURNING id`,
          orgId,
          input.name,
          input.sourceCostCenterId,
          input.base,
          input.periodicity,
        );
        const ruleId = ruleRows[0]!.id;

        for (const target of input.targets) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "CostCenterAllocationTarget"
               ("ruleId", "targetCostCenterId", percentage)
             VALUES ($1, $2, $3)`,
            ruleId,
            target.targetCostCenterId,
            target.percentage,
          );
        }

        return { id: ruleId };
      });

      return result;
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe una regla activa para este centro de apoyo.",
        });
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
    }
  }),

  /**
   * Reemplaza todos los targets de una regla (no actualización parcial).
   *
   * R02: igual que `get`, este UPDATE no verificaba tenant (`WHERE id = $id`
   * a secas) — un id de otra org se actualizaba igual. Con el rol demotado,
   * `alloc_rule_tenant`/`alloc_target_tenant` (cubren UPDATE/DELETE) hacen que
   * un id ajeno afecte 0 filas en vez de escribir cross-tenant.
   */
  update: writerProc.input(updateInput).mutation(async ({ ctx, input }) => {
    if (input.targets) {
      await assertTargetsAreValid(
        ctx.prisma,
        input.targets.map((t) => t.targetCostCenterId),
      );
    }

    try {
      await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const setParts: string[] = [];
        const params: unknown[] = [];
        let idx = 1;

        if (input.name !== undefined) {
          setParts.push(`name = $${idx++}`);
          params.push(input.name);
        }
        if (input.base !== undefined) {
          setParts.push(`base = $${idx++}`);
          params.push(input.base);
        }
        if (input.periodicity !== undefined) {
          setParts.push(`periodicity = $${idx++}`);
          params.push(input.periodicity);
        }

        if (setParts.length) {
          params.push(input.id);
          await tx.$executeRawUnsafe(
            `UPDATE "CostCenterAllocationRule" SET ${setParts.join(", ")} WHERE id = $${idx}`,
            ...params,
          );
        }

        if (input.targets) {
          await tx.$executeRawUnsafe(
            `DELETE FROM "CostCenterAllocationTarget" WHERE "ruleId" = $1`,
            input.id,
          );
          for (const target of input.targets) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "CostCenterAllocationTarget"
                 ("ruleId", "targetCostCenterId", percentage)
               VALUES ($1, $2, $3)`,
              input.id,
              target.targetCostCenterId,
              target.percentage,
            );
          }
        }
      });

      return { id: input.id };
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err instanceof Error ? err.message : "Error al actualizar regla.",
      });
    }
  }),

  /**
   * Desactiva una regla (active=false). No elimina.
   *
   * R02: mismo gap de `update` — sin tenant check en JS. `withTenantContext`
   * cierra el IDOR vía `alloc_rule_tenant` (cubre UPDATE).
   */
  deactivate: writerProc.input(deactivateInput).mutation(async ({ ctx, input }) => {
    try {
      await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "CostCenterAllocationRule" SET active = false WHERE id = $1`,
          input.id,
        ),
      );
      return { id: input.id };
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err instanceof Error ? err.message : "Error al desactivar regla.",
      });
    }
  }),

  /**
   * Calcula prorrateo del periodo — PREVIEW, no persiste.
   *
   * Fuente de costo del sourceCostCenter (en orden de prioridad):
   *   1. HisOperatingCost.amount — si la tabla existe
   *   2. InvoiceItem.unitPrice * quantity via Invoice.issuedAt — si existe
   *   3. 0 — entorno dev / sin datos
   *
   * R02 — decisión (a), y esta es la más seria del lote: `input.organizationId`
   * es un campo del cliente, NO `ctx.tenant.organizationId` — cualquier
   * ADMIN/ACCOUNTANT autenticado en SU org podía pasar el UUID de OTRA org y
   * leer sus reglas de prorrateo + montos de costo (cross-tenant real, no solo
   * IDOR de un id puntual). `withTenantContext` cierra esto de forma
   * estructural: bajo rol demotado, la policy `alloc_rule_tenant` exige
   * `organizationId = current_org_id()` (el de `ctx.tenant`, NO el del input)
   * ADEMÁS del filtro JS `WHERE organizationId = $1 (input)` — la intersección
   * de ambos solo puede ser no-vacía cuando el input coincide con el tenant
   * real. `HisOperatingCost`/`InvoiceItem`/`Invoice` también tienen policies
   * tenant-scoped completas (verificado en prod) y quedan cubiertas al mover
   * las queries internas a `tx`.
   */
  runProration: writerProc.input(runProrationInput).mutation(async ({ ctx, input }) => {
    type ParsedTarget = Omit<TargetRow, "percentage"> & { percentage: number };

    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      let rules: (RuleRow & { targets: ParsedTarget[] })[] = [];

      try {
        const ruleRows = await tx.$queryRawUnsafe<RuleRow[]>(
          `SELECT r.id, r."organizationId", r.name,
                  r."sourceCostCenterId",
                  src.code AS "sourceCode", src.name AS "sourceName",
                  r.base, r.periodicity, r.active
           FROM "CostCenterAllocationRule" r
           JOIN "CostCenter" src ON src.id = r."sourceCostCenterId"
           WHERE r."organizationId" = $1 AND r.active = true`,
          input.organizationId,
        );

        if (!ruleRows.length) return [];

        const targetRows = await fetchTargetsForRules(tx, ruleRows.map((r) => r.id));

        rules = ruleRows.map((rule) => ({
          ...rule,
          targets: targetRows
            .filter((t) => t.ruleId === rule.id)
            .map((t) => ({ ...t, percentage: parseFloat(t.percentage) })),
        }));
      } catch {
        return [];
      }

      const result = await Promise.all(
        rules.map(async (rule) => {
          let totalCosto = 0;

          try {
            const rows = await tx.$queryRawUnsafe<Array<{ total: string }>>(
              `SELECT COALESCE(SUM(amount), 0)::text AS total
               FROM "HisOperatingCost"
               WHERE "costCenterId" = $1
                 AND "date" >= $2::timestamptz
                 AND "date" <= $3::timestamptz`,
              rule.sourceCostCenterId,
              input.periodStart,
              input.periodEnd,
            );
            totalCosto = parseFloat(rows[0]?.total ?? "0");
          } catch {
            // HisOperatingCost no existe; intentar InvoiceItem
            try {
              const rows = await tx.$queryRawUnsafe<Array<{ total: string }>>(
                `SELECT COALESCE(SUM(ii."unitPrice" * ii.quantity), 0)::text AS total
                 FROM "InvoiceItem" ii
                 JOIN "Invoice" inv ON inv.id = ii."invoiceId"
                 WHERE ii."costCenterId" = $1
                   AND inv."issuedAt" >= $2::timestamptz
                   AND inv."issuedAt" <= $3::timestamptz`,
                rule.sourceCostCenterId,
                input.periodStart,
                input.periodEnd,
              );
              totalCosto = parseFloat(rows[0]?.total ?? "0");
            } catch {
              totalCosto = 0;
            }
          }

          return {
            ruleId: rule.id,
            ruleName: rule.name,
            sourceCostCenterCode: rule.sourceCode,
            sourceCostCenterName: rule.sourceName,
            base: rule.base,
            totalProrateado: totalCosto,
            distribuciones: rule.targets.map((target) => ({
              targetCostCenterId: target.targetCostCenterId,
              targetCode: target.targetCode,
              targetName: target.targetName,
              porcentaje: target.percentage,
              monto: parseFloat(((totalCosto * target.percentage) / 100).toFixed(2)),
            })),
          };
        }),
      );

      return result;
    });
  }),
});
