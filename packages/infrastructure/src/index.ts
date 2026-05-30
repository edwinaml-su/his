// Type-only exports separados para evitar SyntaxError en runners que no
// transforman `type` keyword inline (vitest sin TS plugin completo).
export { logger, createLogger } from './observability/logger';
export type { AppLogger } from './observability/logger';
export * from './notifications';
// Re-export argon2 shim para acceso via @his/infrastructure top-level
// (alternativa a @his/infrastructure/firma/argon2 que vitest no resuelve
// correctamente con conditional exports map).
export { default as argon2 } from './firma/argon2';
// Helpers argon2id para hashing de PIN / password (reusados por
// firma electrónica + reset de password admin).
export { hashPin, verifyPin, generateRecoveryToken } from './firma/pin-hasher';
// Cliente XML-RPC para Odoo (lee env vars ODOO_URL/DB/USER/PASSWORD).
export { getOdooClient, getOdooVersion } from './odoo/client';
export type { OdooClient, OdooConfig } from './odoo/client';
export { xmlrpcCall } from './odoo/xmlrpc';
// Cliente SRS El Salvador — read-only del padrón de registro sanitario.
export { buscarPadron, obtenerDetalle, parseVidaUtilMeses } from './srs/client';
export type {
  SrsFiltroBusqueda,
  SrsEstado,
  SrsListadoItem,
  SrsListadoResult,
  SrsDetalle,
  SrsPrincipioActivo,
  SrsFabricante,
  SrsPresentacion,
} from './srs/client';
