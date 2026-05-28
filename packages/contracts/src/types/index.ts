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
  /**
   * IDs de los `ServiceUnit` a los que el usuario está asignado (Nivel A).
   * `[]` (array vacío) = sin asignaciones = puede ver todo el sidebar
   * (compat backward para usuarios pre-Nivel-A o roles cross-servicio como
   * ADMIN, DIR, COO).
   * Si el usuario tiene ≥1 entry y NO es rol cross-servicio, el sidebar se
   * filtra a items cuyo `requiredServiceUnits` intersecte con esta lista.
   *
   * Uso típico: Nivel B (data filtering en routers tRPC con FK por id).
   */
  assignedServiceUnitIds: string[];
  /**
   * `code`s de los `ServiceUnit` a los que el usuario está asignado (Nivel A).
   * Misma cardinalidad y semántica que `assignedServiceUnitIds` — un código
   * por id, mismo orden. Existe en paralelo para que el sidebar
   * (`requiredServiceUnits: ["ER","QX"]`) pueda hacer el match en cliente
   * sin tener que resolver IDs → codes con una query extra.
   */
  assignedServiceUnitCodes: string[];
  /**
   * `true` si el usuario tiene al menos un rol cross-servicio (ADMIN, DIR,
   * COO, CFO, CEO, MEDICAL_DIRECTOR, AUDITOR). Esos roles bypassean el
   * filtro de servicio (pueden ver TODO dentro de su org).
   */
  isCrossServiceRole: boolean;
}

/** Roles que NO se restringen a un servicio específico — ven todo. */
export const CROSS_SERVICE_ROLE_CODES = [
  "ADMIN",
  "DIR",
  "DIRECTOR",
  "MEDICAL_DIRECTOR",
  "COO",
  "CFO",
  "CEO",
  "AUDITOR",
] as const;
export type CrossServiceRoleCode = (typeof CROSS_SERVICE_ROLE_CODES)[number];

export function isCrossServiceRoleCode(code: string): boolean {
  return (CROSS_SERVICE_ROLE_CODES as readonly string[]).includes(code);
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
