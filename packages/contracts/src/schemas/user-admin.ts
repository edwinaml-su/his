/**
 * @his/contracts/schemas/user-admin — schemas para la US-2.3
 * (gestión de usuarios + asignación de roles por organización).
 *
 * Mismo caveat que `rbac.ts`: la barrel está congelada, así que el router
 * importa este archivo por ruta relativa.
 *
 * Contrato del invitation flow (Sprint 1, MVP):
 *   `userAdmin.create` solo crea el registro local en `User` con
 *   `active=true, mfaEnabled=false`. NO crea Auth user en Supabase.
 *   El email queda registrado para que el flujo de invitación
 *   (Sprint 2 — magic-link) lo asocie.
 */
import { z } from "zod";

// -----------------------------------------------------------------------------
// DTOs
// -----------------------------------------------------------------------------

export const userAdminSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(254).toLowerCase(),
  fullName: z.string().trim().min(2).max(200),
  active: z.boolean(),
  mfaEnabled: z.boolean(),
  lastLoginAt: z.date().nullable().optional(),
});

export const userOrganizationRoleSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
  roleId: z.string().uuid(),
  validFrom: z.date(),
  validTo: z.date().nullable(),
});

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export const userAdminListAllInput = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(120).optional(),
    /** Filtro por estado: undefined = todos, true = solo activos, false = solo inactivos. */
    active: z.boolean().optional(),
    /** Filtra usuarios que tengan asignado el rol (code) en cualquier organización vigente. */
    roleCode: z.string().min(1).max(60).optional(),
  })
  .default({});

export const userAdminGetInput = z.object({ id: z.string().uuid() });

export const userAdminCreateInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(2).max(200),
});

export const userAdminUpdateInput = z.object({
  id: z.string().uuid(),
  fullName: z.string().trim().min(2).max(200).optional(),
  active: z.boolean().optional(),
});

export const userAdminDeactivateInput = z.object({ id: z.string().uuid() });

export const userAdminAssignRoleInput = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export const userAdminRevokeRoleInput = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
  roleId: z.string().uuid(),
});

// -----------------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------------

export const userListItemSchema = userAdminSchema.extend({
  /** Cantidad de UserOrganizationRole vigentes (no expiradas). */
  activeRoleCount: z.number().int().min(0),
});

export type UserAdminDTO = z.infer<typeof userAdminSchema>;
export type UserListItemDTO = z.infer<typeof userListItemSchema>;
export type UserAdminCreateInput = z.infer<typeof userAdminCreateInput>;
export type UserAdminAssignRoleInput = z.infer<typeof userAdminAssignRoleInput>;
