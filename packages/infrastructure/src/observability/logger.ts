/**
 * Logger estructurado HIS Multipaís — Pino.
 *
 * Política (TDR §29.4 + §29.8):
 *  - Salida JSON estructurada (Vercel y agregadores la parsean).
 *  - Levels por env: prod=info, staging=info, dev=debug, test=silent.
 *  - PII scrubbing: nunca loguear PHI ni secretos. Usar serializers + redact paths.
 *  - Trace context (request_id, tenant_id, country_id, role) se inyecta como bindings.
 *
 * Uso:
 *   import { logger } from '@his/infrastructure/observability/logger';
 *   logger.info({ encounterId }, 'Encounter created');
 *   const reqLogger = logger.child({ requestId, tenantId });
 *   reqLogger.warn({ code: 'RLS_DENIED' }, 'Acceso denegado');
 */
import pino, { type Logger, type LoggerOptions } from 'pino';

type Env = 'production' | 'staging' | 'preview' | 'development' | 'test';

const env = (process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development') as Env;

const levelByEnv: Record<Env, pino.LevelWithSilent> = {
  production: 'info',
  staging: 'info',
  preview: 'debug',
  development: 'debug',
  test: 'silent',
};

/**
 * Paths que NUNCA deben aparecer en logs (PII/PHI/secretos).
 * Pino redact reemplaza el valor por `[REDACTED]` antes de serializar.
 */
const REDACT_PATHS = [
  // Auth / secretos
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.serviceRoleKey',
  // PII directo
  '*.email',
  '*.phone',
  '*.dui',
  '*.nit',
  '*.firstName',
  '*.lastName',
  '*.fullName',
  '*.address',
  '*.dob',
  '*.birthDate',
  // PHI
  '*.diagnosis',
  '*.icdCode',
  '*.note',
  '*.narrative',
  '*.allergy',
  '*.medication',
  '*.labResult',
  '*.prescription',
];

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? levelByEnv[env] ?? 'info',
  base: {
    env,
    service: 'his-web',
    version: process.env.APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
    remove: false,
  },
  // En dev usamos pino-pretty si está disponible (no es dep de runtime prod).
  ...(env === 'development' && process.stdout.isTTY
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
  // Tiempo en ISO para correlacionar con Sentry / Supabase
  timestamp: pino.stdTimeFunctions.isoTime,
  // Serializadores que evitan dump completo de errores (limita stack a líneas útiles)
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
};

export type AppLogger = Logger;

export const logger: AppLogger = pino(baseOptions);

/**
 * Crea un logger hijo con bindings de contexto request-scoped.
 * Llamar al inicio de cada request handler / Server Action.
 */
export function createLogger(bindings: Record<string, unknown>): AppLogger {
  return logger.child(bindings);
}
