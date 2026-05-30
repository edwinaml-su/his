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

/**
 * Reset de password por ADMIN. Sustituye cualquier `UserCredential` activo
 * con método PASSWORD por uno nuevo (idempotente: cierra el viejo con
 * validTo=now y crea el nuevo en una sola tx).
 *
 * Política mínima de complejidad — alineada con OWASP ASVS L2 v4.0.3 §2.1:
 *   - 12+ caracteres
 *   - al menos 1 letra y 1 dígito (defensa básica anti-diccionario)
 *   - el caller no puede resetear su propio password aquí (debe usar el
 *     flujo de cambio propio que valida el password anterior).
 */
export const userAdminResetPasswordInput = z.object({
  id: z.string().uuid(),
  newPassword: z
    .string()
    .min(12, "Mínimo 12 caracteres.")
    .max(200, "Máximo 200 caracteres.")
    .refine((v) => /[A-Za-z]/.test(v), "Debe incluir al menos una letra.")
    .refine((v) => /[0-9]/.test(v), "Debe incluir al menos un dígito."),
  /** Razón clínica/operativa registrada en audit log (compliance). */
  reason: z.string().trim().min(5).max(500),
});

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
