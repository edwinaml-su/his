/**
 * Roles institucionales con visibilidad multi-organización.
 *
 * Default del sistema: 1 organización × N roles (evita traslapes de
 * responsabilidad). El usuario opera dentro de UNA org y firma documentos
 * con sus roles activos de esa org.
 *
 * EXCEPCIÓN: roles directivos / administrativos pueden tener visibilidad
 * cross-org para reportes consolidados, dashboards de gerencia, etc. Si el
 * usuario tiene cualquiera de estos roles ACTIVO, el switcher de organización
 * permite multi-select (cookie `his.orgs`).
 *
 * Importante: la cookie `his.org` (org primaria) sigue siendo la única usada
 * por queries de escritura para garantizar trazabilidad clara. Las orgs
 * adicionales son opt-in por componente (típicamente dashboards/reports).
 */
// CC-B (directriz Edwin 2026-09-19) — visión corporativa/país:
//   SUPER_ADMIN     — administración global cross-org (ya usado en varios
//                     gates de la app; se agrega aquí para que el switcher
//                     multi-org también lo reconozca).
//   CONTRALOR_CORP  — visión consolidada de operaciones y multi-libro.
//   DIR_PAIS        — dirección sobre las organizaciones de un país (la
//                     asignación de membresías por país la hace el ADMIN a
//                     mano — ver SQL 256; el rol es solo la palanca).
export const MULTI_ORG_ROLE_CODES = [
  "DIR",
  "ADM",
  "JEFE",
  "GERENTE",
  "SUPER_ADMIN",
  "CONTRALOR_CORP",
  "DIR_PAIS",
] as const;

export type MultiOrgRoleCode = (typeof MULTI_ORG_ROLE_CODES)[number];

export function hasMultiOrgRole(roleCodes: ReadonlyArray<string>): boolean {
  return roleCodes.some((code) => MULTI_ORG_ROLE_CODES.includes(code as MultiOrgRoleCode));
}
