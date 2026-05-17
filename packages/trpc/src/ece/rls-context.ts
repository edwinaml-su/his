/**
 * ECE RLS context helper.
 *
 * Las policies RLS del schema `ece` leen dos GUC de Postgres:
 *
 *   - app.ece_personal_id      → uuid del personal sanitario activo
 *   - app.ece_establecimiento_id → uuid del establecimiento activo
 *
 * La función SQL `ece.set_ece_context(personal_id, establecimiento_id)` setea
 * ambos via `SET LOCAL`. `SET LOCAL` SOLO aplica al scope transaccional; fuera
 * de una transacción activa es un no-op silencioso — Postgres no lanza error pero
 * el GUC no persiste y las policies verán NULL → 0 filas. Por eso esta función
 * exige un callback que corre DENTRO de la transacción donde se seteó el contexto.
 *
 * El rol de Supabase que ejecuta queries Prisma tiene BYPASSRLS por default
 * (rol `postgres.<ref>`). Demotamos a `authenticated` para que las policies
 * apliquen efectivamente. Usa `demoteRole: false` para flujos admin/seeders.
 */
import type { PrismaClient } from "@his/database";

export interface EceContextOptions {
  /**
   * Si es false, NO ejecuta `SET LOCAL ROLE authenticated` tras setear el
   * contexto GUC. Default true (demote activo = RLS aplica).
   *
   * Usar false solo en flujos admin/seeders que no están sujetos a RLS ECE.
   */
  demoteRole?: boolean;
}

/**
 * Ejecuta `fn` dentro de una transacción Prisma con el contexto ECE seteado.
 *
 * - Inicia `prisma.$transaction`.
 * - Llama `ece.set_ece_context(personalId, establecimientoId)`.
 * - Demota el rol a `authenticated` (salvo `demoteRole: false`).
 * - Pasa la transacción (`tx`) al callback.
 * - Devuelve lo que `fn` retorne.
 *
 * @example
 * ```ts
 * const historia = await withEceContext(prisma, personalId, establecimientoId, (tx) =>
 *   tx.historiaClinica.findFirst({ where: { id } })
 * );
 * ```
 */
export async function withEceContext<T>(
  prisma: PrismaClient,
  personalId: string,
  establecimientoId: string,
  fn: (tx: PrismaClient) => Promise<T>,
  options: EceContextOptions = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Inyección mitigada: cast a ::uuid aborta la transacción si el valor no
    // es un UUID válido (Postgres lanza "invalid input syntax for type uuid").
    await (tx as unknown as Pick<PrismaClient, "$executeRaw">).$executeRaw`
      SELECT ece.set_ece_context(${personalId}::uuid, ${establecimientoId}::uuid)
    `;

    // Demote DESPUÉS de set_ece_context — la función puede requerir privilegios
    // que solo el rol original tiene. Tras el demote, todas las queries de esta
    // transacción corren como `authenticated` y RLS ECE aplica.
    if (options.demoteRole !== false) {
      await (tx as unknown as Pick<PrismaClient, "$executeRawUnsafe">).$executeRawUnsafe(
        `SET LOCAL ROLE authenticated`,
      );
    }

    return fn(tx as unknown as PrismaClient);
  });
}
