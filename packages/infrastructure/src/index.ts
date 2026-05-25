// Type-only exports separados para evitar SyntaxError en runners que no
// transforman `type` keyword inline (vitest sin TS plugin completo).
export { logger, createLogger } from './observability/logger';
export type { AppLogger } from './observability/logger';
export * from './notifications';
// Re-export argon2 shim para acceso via @his/infrastructure top-level
// (alternativa a @his/infrastructure/firma/argon2 que vitest no resuelve
// correctamente con conditional exports map).
export { default as argon2 } from './firma/argon2';
// Cliente XML-RPC para Odoo (lee env vars ODOO_URL/DB/USER/PASSWORD).
export { getOdooClient, getOdooVersion } from './odoo/client';
export type { OdooClient, OdooConfig } from './odoo/client';
export { xmlrpcCall } from './odoo/xmlrpc';
