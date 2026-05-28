/**
 * Schemas Zod para administración de asignaciones usuario↔servicio (Nivel A).
 *
 * Una entry en `UserServiceUnitAssignment` indica que el usuario opera en
 * `ServiceUnit.id`. El sidebar y (Nivel B futuro) las queries data-layer
 * filtran a esos servicios. Ver `packages/database/sql/60_user_service_unit_assignment.sql`.
 */
import { z } from "zod";

export const userServiceUnitListByUserInput = z.object({
  userId: z.string().uuid(),
  /** Si true, solo asignaciones vigentes (validTo null o futuro). Default: true. */
  onlyActive: z.boolean().default(true),
});
export type UserServiceUnitListByUserInput = z.infer<
  typeof userServiceUnitListByUserInput
>;

export const userServiceUnitListByServiceInput = z.object({
  serviceUnitId: z.string().uuid(),
  onlyActive: z.boolean().default(true),
});
export type UserServiceUnitListByServiceInput = z.infer<
  typeof userServiceUnitListByServiceInput
>;

/**
 * Asigna un usuario a un servicio. Idempotente — si ya existe una
 * asignación vigente con misma terna (user, service, role) → no-op.
 *
 * `roleId` opcional: si está presente, la asignación solo aplica cuando
 * el usuario actúa con ese rol; si es null, aplica con cualquier rol que
 * tenga en la organización del servicio.
 */
export const userServiceUnitAssignInput = z.object({
  userId: z.string().uuid(),
  serviceUnitId: z.string().uuid(),
  roleId: z.string().uuid().nullable().default(null),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().nullable().optional(),
});
export type UserServiceUnitAssignInput = z.infer<typeof userServiceUnitAssignInput>;

/** Revoca una asignación seteando `validTo=now`. */
export const userServiceUnitRevokeInput = z.object({
  id: z.string().uuid(),
});
export type UserServiceUnitRevokeInput = z.infer<typeof userServiceUnitRevokeInput>;
