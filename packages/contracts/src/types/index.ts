/**
 * Tipos compartidos cross-paquete.
 */

/**
 * Contexto multi-tenant resuelto por el servidor a partir de la sesión.
 * Todas las queries que toquen datos clínicos / contables deben recibirlo.
 */
export interface TenantContext {
  userId: string;
  countryId: string;
  organizationId: string;
  establishmentId?: string;
  /** Códigos de roles que el usuario tiene en la organización activa. */
  roleCodes: string[];
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Result type para devolver operaciones de dominio sin throw.
 * Convención: `ok` discrimina la unión.
 */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
