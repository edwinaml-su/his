export { logger, createLogger, type AppLogger } from './observability/logger';
export * from './notifications';
// Re-export argon2 shim para acceso via @his/infrastructure top-level
// (alternativa a @his/infrastructure/firma/argon2 que vitest no resuelve
// correctamente con conditional exports map).
export { default as argon2 } from './firma/argon2';
