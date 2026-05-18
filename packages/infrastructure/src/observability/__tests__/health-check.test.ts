/**
 * Tests para packages/infrastructure/src/observability/health-check.ts
 *
 * Estrategia: inyección de dependencias vía opts.prisma — evita vi.mock del
 * módulo @his/database y sus side effects de inicialización Prisma.
 *
 * Cubre (≥8 casos):
 *  1. DB ok → status 'ok'
 *  2. DB falla ($queryRaw lanza) → status 'fail'
 *  3. DB timeout (Promise que rechaza rápido simulando timeout) → 'fail'
 *  4. Auth ok — NEXTAUTH_SECRET presente
 *  5. Auth ok — SUPABASE_JWT_SECRET presente (fallback)
 *  6. Auth fail — ningún secret presente
 *  7. RLS ok — $queryRaw con current_setting resuelve → 'ok'
 *  8. RLS fail — $queryRaw lanza → 'fail'
 *  9. runHealthChecks: todos ok → timestamp en formato ISO 8601
 * 10. runHealthChecks: DB+RLS fail → reflejados correctamente
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runHealthChecks, type HealthStatus, type PrismaLike } from '../health-check';

// ---------------------------------------------------------------------------
// Helpers de entorno
// ---------------------------------------------------------------------------
function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Factory de mock de Prisma
// ---------------------------------------------------------------------------
function makePrismaMock(opts?: {
  resolveValue?: unknown;
  rejectError?: Error;
  rejectAfterMs?: number;
}): PrismaLike {
  const fn = vi.fn();

  if (opts?.rejectAfterMs !== undefined) {
    fn.mockReturnValue(
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(opts.rejectError ?? new Error('timeout')), opts.rejectAfterMs),
      ),
    );
  } else if (opts?.rejectError) {
    fn.mockRejectedValue(opts.rejectError);
  } else {
    fn.mockResolvedValue(opts?.resolveValue ?? [{ result: 1 }]);
  }

  return { $queryRaw: fn as unknown as PrismaLike['$queryRaw'] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('health-check', () => {
  beforeEach(() => {
    setEnv('NEXTAUTH_SECRET', 'test-secret-value');
    setEnv('SUPABASE_JWT_SECRET', undefined);
  });

  afterEach(() => {
    setEnv('NEXTAUTH_SECRET', undefined);
    setEnv('SUPABASE_JWT_SECRET', undefined);
  });

  // --- DB checks ---

  it('1. db: ok cuando $queryRaw resuelve sin error', async () => {
    const prisma = makePrismaMock();
    const result = await runHealthChecks({ prisma });
    expect(result.db).toBe('ok');
  });

  it('2. db: fail cuando $queryRaw lanza error', async () => {
    const prisma = makePrismaMock({ rejectError: new Error('connection refused') });
    const result = await runHealthChecks({ prisma });
    expect(result.db).toBe('fail');
  });

  it('3. db: fail cuando $queryRaw expira (timeout simulado)', async () => {
    const prisma = makePrismaMock({
      rejectError: new Error('db timeout after 4000ms'),
      rejectAfterMs: 10,
    });
    const result = await runHealthChecks({ prisma });
    expect(result.db).toBe('fail');
  });

  // --- Auth checks ---

  it('4. auth: ok cuando NEXTAUTH_SECRET está presente', async () => {
    setEnv('NEXTAUTH_SECRET', 'some-secret-value');
    const prisma = makePrismaMock();
    const result = await runHealthChecks({ prisma });
    expect(result.auth).toBe('ok');
  });

  it('5. auth: ok cuando SUPABASE_JWT_SECRET presente (fallback)', async () => {
    setEnv('NEXTAUTH_SECRET', undefined);
    setEnv('SUPABASE_JWT_SECRET', 'supabase-jwt-secret');
    const prisma = makePrismaMock();
    const result = await runHealthChecks({ prisma });
    expect(result.auth).toBe('ok');
  });

  it('6. auth: fail cuando ningún JWT secret está presente', async () => {
    setEnv('NEXTAUTH_SECRET', undefined);
    setEnv('SUPABASE_JWT_SECRET', undefined);
    const prisma = makePrismaMock();
    const result = await runHealthChecks({ prisma });
    expect(result.auth).toBe('fail');
  });

  // --- RLS checks ---

  it('7. rls: ok cuando current_setting query resuelve sin error', async () => {
    const prisma = makePrismaMock({ resolveValue: [{ v: null }] });
    const result = await runHealthChecks({ prisma });
    expect(result.rls).toBe('ok');
  });

  it('8. rls: fail cuando $queryRaw lanza (GUC no disponible)', async () => {
    // El mismo mock que rechaza para ambos checks (db + rls comparten el cliente)
    const prisma = makePrismaMock({ rejectError: new Error('GUC not available') });
    const result = await runHealthChecks({ prisma });
    expect(result.rls).toBe('fail');
  });

  // --- runHealthChecks: checks agregados ---

  it('9. runHealthChecks: timestamp presente y en formato ISO 8601', async () => {
    const prisma = makePrismaMock();
    const result: HealthStatus = await runHealthChecks({ prisma });
    expect(result.timestamp).toBeTruthy();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
  });

  it('10. runHealthChecks: db=fail + auth=fail cuando el cliente y env fallan', async () => {
    setEnv('NEXTAUTH_SECRET', undefined);
    setEnv('SUPABASE_JWT_SECRET', undefined);
    const prisma = makePrismaMock({ rejectError: new Error('db down') });

    const result = await runHealthChecks({ prisma });
    expect(result.db).toBe('fail');
    expect(result.auth).toBe('fail');
    expect(result.rls).toBe('fail');
    expect(result.timestamp).toBeTruthy();
  });
});
