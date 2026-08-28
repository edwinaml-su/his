/**
 * @his/contracts/schemas/user-admin — schemas para la US-2.3
 * (gestión de usuarios + asignación de roles por organización).
 *
 * Mismo caveat que `rbac.ts`: la barrel está congelada, así que el router
 * importa este archivo por ruta relativa.
 *
 * Invitation flow (CC-0019, funcional):
 *   `userAdmin.create` crea la cuenta en Supabase Auth (`auth.users`, sin
 *   password) Y el registro local en `User`, y envía un correo de
 *   invitación con un enlace para que el usuario fije su propia contraseña.
 *   `userAdmin.resendInvitation` reenvía el enlace (o provisiona la cuenta
 *   Auth si faltaba — huérfanos detectados por `userAdmin.listSinCuentaAuth`).
 *   Ver `packages/trpc/src/routers/user-admin.router.ts` y
 *   `docs/CC/0019/REQ-SEC-USR-001-alta-usuario-auth.md`.
 */
import { z } from "zod";
import { validatePassword } from "./password";

/**
 * Estado de la cuenta de autenticación (Supabase Auth) de un usuario local,
 * derivado en el router (no persistido — ver `userAdmin.listAll`/`get`):
 *   - SIN_CUENTA: no existe fila en `auth.users` para ese email.
 *   - INVITADO:   existe la cuenta pero nunca completó login (`last_sign_in_at IS NULL`).
 *   - ACTIVO:     ya inició sesión al menos una vez.
 */
export const userAuthStatusSchema = z.enum(["SIN_CUENTA", "INVITADO", "ACTIVO"]);
export type UserAuthStatus = z.infer<typeof userAuthStatusSchema>;

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

/** Reenvía (o provisiona si faltaba) la invitación de acceso de un usuario. */
export const userAdminResendInvitationInput = z.object({ userId: z.string().uuid() });

/**
 * Reset de password por ADMIN. Sustituye cualquier `UserCredential` activo
 * con método PASSWORD por uno nuevo (idempotente: cierra el viejo con
 * validTo=now y crea el nuevo en una sola tx).
 *
 * Política completa Avante (`validatePassword` de `./password`, misma que
 * alimenta el medidor de fuerza en el form) — 12+ caracteres, mayúscula,
 * minúscula, dígito y símbolo. Antes de este fix el servidor solo exigía
 * letra+dígito, más laxo que lo que el medidor mostraba (hallazgo PR #580):
 *   - el caller no puede resetear su propio password aquí (debe usar el
 *     flujo de cambio propio que valida el password anterior).
 */
export const userAdminResetPasswordInput = z.object({
  id: z.string().uuid(),
  newPassword: z
    .string()
    .max(200, "Máximo 200 caracteres.")
    .superRefine((value, ctx) => {
      const result = validatePassword(value);
      for (const message of result.errors) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    }),
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
  /** CC-0019 — estado de la cuenta Supabase Auth asociada (por email). */
  authStatus: userAuthStatusSchema,
});

export type UserAdminDTO = z.infer<typeof userAdminSchema>;
export type UserListItemDTO = z.infer<typeof userListItemSchema>;
export type UserAdminCreateInput = z.infer<typeof userAdminCreateInput>;
export type UserAdminAssignRoleInput = z.infer<typeof userAdminAssignRoleInput>;
