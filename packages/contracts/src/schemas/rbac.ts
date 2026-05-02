/**
 * @his/contracts/schemas/rbac — schemas Zod para la US-2.3
 * (RBAC, gestión de roles y matriz de permisos por rol).
 *
 * NOTA: la barrel `schemas/index.ts` está congelada en Sprint 1, por lo que
 * estos schemas no se re-exportan desde `@his/contracts`. Los routers tRPC
 * importan este archivo por ruta relativa
 * (`../../../contracts/src/schemas/rbac`); la UI los puede importar igual o
 * trabajar con los tipos inferidos vía `AppRouter`.
 *
 * El schema Prisma (Role, Permission, RolePermission) NO se modifica.
 */
import { z } from "zod";

// -----------------------------------------------------------------------------
// Constantes de dominio
// -----------------------------------------------------------------------------

/** TDR §6.2 — efecto del permiso (espejo del enum Prisma `PermissionEffect`). */
export const permissionEffectEnum = z.enum(["ALLOW", "DENY"]);
export type PermissionEffect = z.infer<typeof permissionEffectEnum>;

/**
 * Roles base del HIS. La UI puede usar este listado para etiquetas /
 * traducciones; los registros reales viven en la tabla Role (seed).
 */
export const BASE_ROLE_CODES = [
  "super_admin",
  "admin_clinico",
  "admision",
  "triador",
  "enfermeria",
  "medico",
  "jefe_servicio",
  "lectura",
] as const;
export type BaseRoleCode = (typeof BASE_ROLE_CODES)[number];

/** Recursos conocidos para agrupar la matriz de permisos en la UI. */
export const KNOWN_RESOURCES = [
  "patient",
  "encounter",
  "triage",
  "bed",
  "consent",
  "audit",
  "rbac",
  "user",
  "organization",
  "catalog",
  "rx",
] as const;

// -----------------------------------------------------------------------------
// DTOs
// -----------------------------------------------------------------------------

export const roleSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-zA-Z0-9_\-.]+$/, "Solo letras, números, _, -, ."),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean(),
});

export const permissionSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(2).max(120),
  resource: z.string().min(1).max(60),
  action: z.string().min(1).max(40),
});

export const rolePermissionSchema = z.object({
  permissionId: z.string().uuid(),
  effect: permissionEffectEnum,
});

// -----------------------------------------------------------------------------
// Inputs router rbac
// -----------------------------------------------------------------------------

export const rbacListRolesInput = z
  .object({
    /** Si true, devuelve también roles globales (organizationId = null). Default true. */
    includeGlobal: z.boolean().default(true),
    /** Filtra por activos (default true). */
    activeOnly: z.boolean().default(true),
    search: z.string().trim().min(1).max(120).optional(),
  })
  .default({});

export const rbacGetRoleInput = z.object({ id: z.string().uuid() });

export const rbacCreateRoleInput = z.object({
  code: roleSchema.shape.code,
  name: roleSchema.shape.name,
  description: roleSchema.shape.description,
  /**
   * `null` => rol global (solo super_admin podrá crearlo);
   * `undefined` => usar la organización del tenant context.
   */
  organizationId: z.string().uuid().nullable().optional(),
});

export const rbacUpdateRoleInput = z.object({
  id: z.string().uuid(),
  name: roleSchema.shape.name.optional(),
  description: roleSchema.shape.description,
  active: z.boolean().optional(),
});

export const rbacDeactivateRoleInput = z.object({ id: z.string().uuid() });

/** Mutación masiva: reemplaza el set actual de permisos de un rol. */
export const rbacSetRolePermissionsInput = z.object({
  roleId: z.string().uuid(),
  permissions: z.array(rolePermissionSchema),
});

// -----------------------------------------------------------------------------
// Outputs (no estrictamente validados en runtime; útiles para tipar UI)
// -----------------------------------------------------------------------------

export const roleWithStatsSchema = roleSchema.extend({
  /** Cantidad de UserOrganizationRole vigentes apuntando al rol. */
  userCount: z.number().int().min(0),
  /** Cantidad de permisos ALLOW asignados al rol. */
  allowCount: z.number().int().min(0),
  /** Cantidad total de RolePermission (ALLOW+DENY). */
  permissionCount: z.number().int().min(0),
});

export type RoleDTO = z.infer<typeof roleSchema>;
export type RoleWithStatsDTO = z.infer<typeof roleWithStatsSchema>;
export type PermissionDTO = z.infer<typeof permissionSchema>;
export type RolePermissionDTO = z.infer<typeof rolePermissionSchema>;
export type RbacSetRolePermissionsInput = z.infer<typeof rbacSetRolePermissionsInput>;
export type RbacCreateRoleInput = z.infer<typeof rbacCreateRoleInput>;
export type RbacUpdateRoleInput = z.infer<typeof rbacUpdateRoleInput>;
