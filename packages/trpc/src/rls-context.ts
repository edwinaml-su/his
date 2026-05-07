/**
 * @his/trpc — RLS context helper (US-1.7).
 *
 * Setea las GUC de Postgres que las policies de `01_rls_policies.sql` leen
 * (vía `04_rls_session_helpers.sql`):
 *
 *   - app.current_user_id  → uuid del usuario activo
 *   - app.current_org_id   → uuid de la organización activa
 *   - app.is_break_glass   → boolean (acceso de emergencia, auditado)
 *
 * Uso obligatorio: dentro de una transacción Prisma (`$transaction`), porque
 * `SET LOCAL` solo aplica al scope transaccional. Fuera de transacción,
 * `SET LOCAL` es un no-op silencioso.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Estado MVP (Sprint 1):
 *   La aplicación valida tenant en aplicación (cada router filtra por
 *   `organizationId = ctx.tenant.organizationId`), por lo que llamar a este
 *   helper es OPCIONAL. Lo mantenemos como utilidad para los tests de
 *   `rls-isolation.test.ts` y para módulos que opten por defensa en profundidad.
 *
 * Plan Fase 2+:
 *   Una vez que todos los routers usen `withTenantContext`, podremos
 *   considerar revocar los grants directos sobre las tablas tenant-scoped
 *   y obligar a que TODA query pase por el contexto. Eso protege contra:
 *     - Bugs en filtros aplicación-side.
 *     - Queries ad-hoc desde herramientas (psql, dashboards) sin filtro.
 *     - SQL injection que evada el `where` de Prisma.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { PrismaClient } from "@prisma/client";
import type { TenantContext } from "@his/contracts";

export interface RlsContextOptions {
  /** Si es true, el GUC `app.is_break_glass` se setea a true. Audit trail aparte. */
  breakGlass?: boolean;
  /**
   * Si es false, NO ejecuta `SET LOCAL ROLE authenticated` después de
   * setear el contexto. Default true: encadenar GUC + demote para que
   * Prisma queries dentro de la transacción ya no bypaseen RLS (el rol
   * `postgres.<ref>` de Supabase tiene BYPASSRLS por default).
   *
   * Useful escapar a false en flujos administrativos que necesitan tocar
   * tablas con grants restrictivos al rol authenticated (ej. seeders).
   */
  demoteRole?: boolean;
}

/**
 * Aplica las GUC de tenant a la transacción actual.
 * Pensado para llamarse como primera operación dentro de un `prisma.$transaction`.
 *
 * Postgres rechaza `SET LOCAL` con valores no parseables; los UUID se validan
 * con un cast a `::uuid` en el SQL (lanza `invalid input syntax for type uuid`
 * si el caller pasó basura).
 *
 * Por default también demota el rol a `authenticated` (defensa en profundidad
 * — sin esto, queries Prisma usan el rol bypass-RLS y el filtro tenant solo
 * vive en código aplicación). Pasar `demoteRole: false` para excepciones.
 */
export async function applyTenantContext(
  tx: Pick<PrismaClient, "$executeRawUnsafe">,
  tenant: Pick<TenantContext, "userId" | "organizationId">,
  options: RlsContextOptions = {},
): Promise<void> {
  // `set_tenant_context` viene de `04_rls_session_helpers.sql`.
  // Usamos $executeRawUnsafe + parámetros embebidos vía cast porque
  // `SET LOCAL` no acepta placeholders parametrizados de protocolo extendido.
  // Mitigación de injection: castear a ::uuid; si el valor no es UUID válido
  // Postgres aborta la transacción.
  const userId = String(tenant.userId).replace(/'/g, "''");
  const orgId = String(tenant.organizationId).replace(/'/g, "''");
  const bg = options.breakGlass ? "true" : "false";

  await tx.$executeRawUnsafe(
    `SELECT public.set_tenant_context('${userId}'::uuid, '${orgId}'::uuid, ${bg});`,
  );

  // Demote DESPUÉS de set_tenant_context — la función necesita EXECUTE que
  // posiblemente solo el rol original tenga. Tras esto, todas las queries
  // de la transacción se ejecutan como `authenticated` y RLS aplica.
  if (options.demoteRole !== false) {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
  }
}

/**
 * Borra el contexto tenant en la transacción actual.
 * Tras esto, las policies RLS verán `current_org_id() = NULL` → 0 filas.
 *
 * Por default también demota el rol a `authenticated` para que las policies
 * apliquen efectivamente (el rol original puede tener BYPASSRLS).
 */
export async function clearTenantContext(
  tx: Pick<PrismaClient, "$executeRawUnsafe">,
  options: { demoteRole?: boolean } = {},
): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT public.clear_tenant_context();`);
  if (options.demoteRole !== false) {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
  }
}

/**
 * Azúcar: ejecuta `fn` dentro de un `prisma.$transaction` con el tenant
 * context aplicado al inicio. Devuelve lo que devuelva `fn`.
 *
 * Ejemplo:
 *
 *   const patient = await withTenantContext(prisma, ctx.tenant, async (tx) => {
 *     return tx.patient.findFirst({ where: { id } });
 *   });
 */
export async function withTenantContext<T>(
  prisma: PrismaClient,
  tenant: Pick<TenantContext, "userId" | "organizationId">,
  fn: (tx: PrismaClient) => Promise<T>,
  options: RlsContextOptions = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await applyTenantContext(tx as unknown as PrismaClient, tenant, options);
    return fn(tx as unknown as PrismaClient);
  });
}
