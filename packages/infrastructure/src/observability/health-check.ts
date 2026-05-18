/**
 * health-check.ts — Helper de healthcheck para HIS Multipaís
 *
 * Verifica tres componentes críticos sin exponer PII:
 *  - db:   SELECT 1 contra la base de datos (Prisma)
 *  - auth: JWT secret presente en el proceso
 *  - rls:  GUC `app.current_org_id` accesible vía current_setting
 *
 * Diseño: los checks de DB y RLS reciben el cliente Prisma como parámetro
 * opcional, lo que facilita el testing sin mocks de módulos.
 * Si no se inyecta, se importa `@his/database` dinámicamente.
 *
 * NO depende de next/server — usable desde scripts, workers y rutas.
 */

export type CheckResult = 'ok' | 'fail';

export interface HealthStatus {
  db: CheckResult;
  auth: CheckResult;
  rls: CheckResult;
  timestamp: string;
}

/** Subconjunto mínimo de PrismaClient necesario para los checks. */
export interface PrismaLike {
  $queryRaw: (...args: unknown[]) => Promise<unknown>;
}

const TIMEOUT_MS = 4_000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    ),
  ]);
}

async function getPrisma(injected?: PrismaLike): Promise<PrismaLike> {
  if (injected) return injected;
  const mod = await import('@his/database');
  return mod.prisma as PrismaLike;
}

/**
 * Verifica `SELECT 1` contra Postgres via Prisma.
 */
async function checkDb(prismaClient?: PrismaLike): Promise<CheckResult> {
  try {
    const prisma = await getPrisma(prismaClient);
    await withTimeout(
      (prisma.$queryRaw as (s: TemplateStringsArray) => Promise<unknown>)`SELECT 1`,
      'db',
    );
    return 'ok';
  } catch {
    return 'fail';
  }
}

/**
 * Valida que NEXTAUTH_SECRET o SUPABASE_JWT_SECRET esté presente.
 */
function checkAuth(): CheckResult {
  const hasJwtSecret =
    Boolean(process.env.NEXTAUTH_SECRET) || Boolean(process.env.SUPABASE_JWT_SECRET);
  return hasJwtSecret ? 'ok' : 'fail';
}

/**
 * Verifica que `current_setting('app.current_org_id', true)` sea accesible.
 * Solo comprueba que la query no lance excepción — el GUC puede ser NULL en
 * contexto sin tenant (health probe no necesita setearlo).
 */
async function checkRls(prismaClient?: PrismaLike): Promise<CheckResult> {
  try {
    const prisma = await getPrisma(prismaClient);
    await withTimeout(
      (async () => {
        const fn = prisma.$queryRaw as (s: TemplateStringsArray) => Promise<unknown>;
        await fn`SELECT current_setting('app.current_org_id', true) AS v`;
      })(),
      'rls',
    );
    return 'ok';
  } catch {
    return 'fail';
  }
}

/** Opciones para inyectar dependencias en tests. */
export interface HealthCheckOptions {
  /** Inyectar un cliente Prisma mock — si no se provee, se usa @his/database. */
  prisma?: PrismaLike;
}

/**
 * Ejecuta los tres checks y retorna el HealthStatus agregado.
 */
export async function runHealthChecks(opts?: HealthCheckOptions): Promise<HealthStatus> {
  const [db, rls] = await Promise.all([
    checkDb(opts?.prisma),
    checkRls(opts?.prisma),
  ]);
  const auth = checkAuth();

  return {
    db,
    auth,
    rls,
    timestamp: new Date().toISOString(),
  };
}
