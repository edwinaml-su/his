import { z } from "zod";

/**
 * US-1.8 — esquemas de auditoría organizacional.
 *
 * El visor de cambios estructurales (organizations/audit) consume `listOrgChanges`
 * con filtros opcionales por entidad, rango de fechas, acción y usuario.
 *
 * NOTE: el schema Prisma de AuditLog no se modifica; sólo agregamos contratos
 * tipados en frontera para el router y la UI.
 */

export const auditActionSchema = z.enum([
  "CREATE",
  "READ",
  "UPDATE",
  "DELETE",
  "PRINT",
  "EXPORT",
  "SIGN",
  "VOID",
  "LOGIN",
  "LOGOUT",
  "BREAK_GLASS",
]);

export const auditEntityKindSchema = z.enum([
  "Organization",
  "Establishment",
  "ALL",
]);

export const listOrgChangesInputSchema = z.object({
  /** Si se provee, filtra por entityId (org o establishment específico). */
  organizationId: z.string().uuid().optional(),
  /** Filtro por tipo de entidad. ALL = Organization + Establishment. */
  entityKind: auditEntityKindSchema.default("ALL"),
  /** Filtro por acción concreta. */
  action: auditActionSchema.optional(),
  /** Filtro por usuario que ejecutó la acción. */
  userId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

/**
 * DTO de salida — el `id` de AuditLog es BigInt en BD; lo serializamos como
 * string para evitar problemas con superjson/bigint en algunos clientes.
 */
export const auditLogEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.date(),
  userId: z.string().uuid().nullable(),
  userLabel: z.string().nullable(),
  organizationId: z.string().uuid().nullable(),
  action: auditActionSchema,
  entity: z.string(),
  entityId: z.string().nullable(),
  beforeJson: z.unknown().nullable(),
  afterJson: z.unknown().nullable(),
  /** Diff resumido — claves cuyo valor cambió entre before y after. */
  changedFields: z.array(z.string()),
  justification: z.string().nullable(),
});

export const listOrgChangesResultSchema = z.object({
  items: z.array(auditLogEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});

export type ListOrgChangesInput = z.infer<typeof listOrgChangesInputSchema>;
export type AuditLogEntryDTO = z.infer<typeof auditLogEntrySchema>;
export type ListOrgChangesResult = z.infer<typeof listOrgChangesResultSchema>;
export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditEntityKind = z.infer<typeof auditEntityKindSchema>;
