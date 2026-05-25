/**
 * @his/trpc — workflow context helper (Fase 2, ECE/GS1).
 *
 * Análogo a `rls-context.ts` pero para los GUC del módulo ECE:
 *
 *   - app.establecimiento_id  → uuid del establecimiento activo
 *   - app.ece_personal_id     → uuid del personal ECE ejecutor
 *   - app.is_break_glass      → boolean (acceso de emergencia, auditado)
 *
 * Obligatorio dentro de una transacción Prisma (`$transaction`) porque
 * `SET LOCAL` solo aplica al scope transaccional.
 */
import type { PrismaClient } from "@prisma/client";

/** Contexto de identidad ECE pasado por el caller. */
export interface EceContext {
  /** UUID del personal ECE que ejecuta la acción. */
  personalId: string;
  /** UUID del establecimiento activo. */
  establecimientoId: string;
  /** Roles del usuario (informativo; la autorización efectiva la hace RLS). */
  roles?: string[];
}

export interface WorkflowContextOptions {
  /** Si es true, el GUC `app.is_break_glass` se setea a true. */
  breakGlass?: boolean;
  /**
   * Si es false, NO ejecuta `SET LOCAL ROLE authenticated`.
   * Default true: demota para que RLS aplique en la transacción.
   * Pasar false solo en flujos admin/seeder.
   */
  demoteRole?: boolean;
}

/**
 * Aplica los GUC de ECE workflow a la transacción activa.
 * Debe llamarse como primera operación dentro del callback de `prisma.$transaction`.
 */
export async function applyWorkflowContext(
  tx: Pick<PrismaClient, "$executeRawUnsafe">,
  ctx: EceContext,
  options: WorkflowContextOptions = {},
): Promise<void> {
  // Mitigación de injection: escapar comillas simples. NOTA: PostgreSQL no
  // acepta casts (`::`) en el RHS de `SET LOCAL` — provoca syntax error 42601.
  // Los valores se almacenan como texto; las funciones consumidoras (RLS,
  // triggers, current_setting()) hacen el cast a uuid donde sea necesario.
  const personalId = String(ctx.personalId).replace(/'/g, "''");
  const establecimientoId = String(ctx.establecimientoId).replace(/'/g, "''");
  const bg = options.breakGlass ? "true" : "false";

  await tx.$executeRawUnsafe(
    `SET LOCAL "app.ece_personal_id" = '${personalId}';`,
  );
  // NOTA: el GUC debe llamarse "app.ece_establecimiento_id" (con prefijo ece_)
  // porque las funciones BD lo leen así: ece.current_establecimiento_id() y
  // ece.set_ece_context() — un nombre distinto deja el GUC seteado pero
  // current_setting() devuelve vacío y rompe RLS.
  await tx.$executeRawUnsafe(
    `SET LOCAL "app.ece_establecimiento_id" = '${establecimientoId}';`,
  );
  await tx.$executeRawUnsafe(
    `SET LOCAL "app.is_break_glass" = '${bg}';`,
  );

  if (options.demoteRole !== false) {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
  }
}

/**
 * Ejecuta `fn` dentro de un `prisma.$transaction` con el contexto ECE workflow
 * aplicado al inicio. Devuelve lo que devuelva `fn`.
 *
 * Ejemplo:
 *
 *   const order = await withWorkflowContext(prisma, ctx, async (tx) => {
 *     return tx.workflowInstance.create({ data: { ... } });
 *   });
 */
export async function withWorkflowContext<T>(
  prisma: PrismaClient,
  ctx: EceContext,
  fn: (tx: PrismaClient) => Promise<T>,
  options: WorkflowContextOptions = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await applyWorkflowContext(tx as unknown as PrismaClient, ctx, options);
    return fn(tx as unknown as PrismaClient);
  });
}
