/**
 * Harness de integración "schema contract" para routers ECE con SQL crudo.
 *
 * PROBLEMA que resuelve: los tests unitarios mockean `$queryRaw`/`$executeRaw`,
 * así que NO atrapan el drift entre el SQL del router y el DDL vivo (columnas
 * inexistentes, valores fuera de CHECK, enums inválidos, NOT NULL omitidos).
 * Un router puede estar roto en producción y pasar CI. Este harness ejecuta el
 * router REAL contra una BD REAL y atrapa esa clase entera.
 *
 * DISEÑO:
 *   - `withRollback` corre `fn` dentro de UNA transacción que SIEMPRE hace
 *     rollback → nada persiste (seguro incluso contra una BD compartida; sin
 *     contaminar audit-log/outbox).
 *   - El proxy que recibe `fn` se usa como `ctx.prisma`. Su `$transaction(cb)`
 *     corre `cb` INLINE sobre la misma tx (sin anidar) — así el
 *     `withWorkflowContext` del router comparte nuestra única tx con rollback.
 *   - Intercepta `SET LOCAL ROLE authenticated` y lo descarta: el harness valida
 *     pura validez de ESQUEMA como rol BYPASSRLS. La autorización RLS se cubre
 *     aparte (rls-isolation tests). Aislar drift de RLS evita falsos negativos.
 *
 * GATING: usar `describe.skipIf(!hasIntegrationDb())`. En CI corre como job
 * separado contra una BD efímera con `INTEGRATION_DB=1` + `DATABASE_URL` seteado.
 */
import { PrismaClient } from "@prisma/client";

const ROLLBACK = Symbol("rollback-harness");

/** URL de la BD de integración. Prefiere DIRECT_URL (sesión, 5432) porque las
 *  transacciones interactivas no funcionan sobre el pooler en transaction mode. */
function integrationDbUrl(): string | undefined {
  return process.env.DIRECT_URL || process.env.DATABASE_URL;
}

/** True si el harness debe correr (job de integración con BD real). */
export function hasIntegrationDb(): boolean {
  return process.env.INTEGRATION_DB === "1" && !!integrationDbUrl();
}

/** Cliente Prisma conectado a la BD de integración (DIRECT_URL del entorno). */
export function makeIntegrationPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: integrationDbUrl() });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

function makeProxy(outerTx: AnyDb): AnyDb {
  const proxy: AnyDb = new Proxy(outerTx, {
    get(target, prop) {
      // El router hace `ctx.prisma.$transaction(...)` (vía withWorkflowContext).
      // Lo corremos INLINE sobre la misma tx para no anidar transacciones
      // interactivas (Prisma no lo soporta) y para que todo comparta el rollback.
      if (prop === "$transaction") {
        return (cb: (tx: AnyDb) => Promise<unknown>) => cb(proxy);
      }
      // Descartar la democión de rol: corremos como BYPASSRLS (drift puro).
      if (prop === "$executeRawUnsafe") {
        return (sql: string, ...args: unknown[]) => {
          if (typeof sql === "string" && /set\s+local\s+role/i.test(sql)) {
            return Promise.resolve(0);
          }
          return target.$executeRawUnsafe(sql, ...args);
        };
      }
      // El harness valida el SQL CRUDO contra ece.* (la clase de drift que los
      // tests mockeados no ven). Las escrituras vía modelo Prisma tipado
      // (outbox `domainEvent` + `auditLog`) NO son esa clase (typecheck las
      // cubre) → se stubean para no acoplar el harness al stub de @his/database.
      if (prop === "domainEvent" || prop === "auditLog") {
        return { create: async () => ({ id: "harness-stub" }) };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return proxy;
}

/**
 * Ejecuta `fn` contra la BD real en UNA transacción con rollback garantizado.
 * `fn` recibe un proxy prisma-like para usar como `ctx.prisma`. Devuelve lo que
 * devuelva `fn`. Nada se persiste.
 */
export async function withRollback<T>(
  prisma: PrismaClient,
  fn: (db: AnyDb) => Promise<T>,
): Promise<T> {
  let captured: T;
  let ran = false;
  try {
    await prisma.$transaction(
      async (outerTx) => {
        const proxy = makeProxy(outerTx);
        // Bypass de enforcement de dependencias de workflow (GUC de seeder),
        // equivalente a una BD recién sembrada.
        await proxy.$executeRawUnsafe(
          "SELECT set_config('app.skip_dependencias_enforcement','true', true)",
        );
        captured = await fn(proxy);
        ran = true;
        throw ROLLBACK;
      },
      // El default de Prisma (5s) es muy corto para un flujo con ~13 round-trips
      // contra una BD remota → P2028 "Transaction not found".
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e === ROLLBACK) return captured!;
    throw e;
  }
  // Inalcanzable (siempre lanzamos ROLLBACK), pero satisface el control de flujo.
  if (!ran) throw new Error("withRollback: fn no se ejecutó");
  return captured!;
}
