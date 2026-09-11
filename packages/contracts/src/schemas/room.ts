import { z } from "zod";

/**
 * Room — habitación, espejo de hospital.ward (Odoo ACS HMS).
 * sql/231_room_bed_odoo_mirror.sql, encargo Edwin 2026-09-11.
 */

export const roomTypeEnum = z.enum([
  "GENERAL",
  "SEMI_ESPECIAL",
  "DELUXE",
  "SUPER_DELUXE",
  "SUITE",
  "COMPARTIDA",
  "UCI",
  "DIALISIS",
  "RECUPERACION",
]);

export const roomGenderPolicyEnum = z.enum(["HOMBRES", "MUJERES", "UNISEX"]);

export const roomInvoicePolicyEnum = z.enum(["DIA", "HORA"]);

const glnCodigoSchema = z
  .string()
  .length(13)
  .regex(/^\d{13}$/, "GLN-13: 13 dígitos numéricos");

export const roomListSchema = z
  .object({
    establishmentId: z.string().uuid().optional(),
    serviceUnitId: z.string().uuid().optional(),
    activeOnly: z.boolean().optional(),
  })
  .optional();

export const roomCreateSchema = z.object({
  establishmentId: z.string().uuid(),
  serviceUnitId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  floor: z.string().trim().max(10).optional(),
  roomType: roomTypeEnum.optional(),
  genderPolicy: roomGenderPolicyEnum.optional(),
  private: z.boolean().optional(),
  bioHazard: z.boolean().optional(),
  airConditioning: z.boolean().optional(),
  television: z.boolean().optional(),
  telephone: z.boolean().optional(),
  privateBathroom: z.boolean().optional(),
  internet: z.boolean().optional(),
  refrigerator: z.boolean().optional(),
  microwave: z.boolean().optional(),
  guestSofa: z.boolean().optional(),
  chargeCode: z.string().trim().max(40).optional(),
  invoicePolicy: roomInvoicePolicyEnum.optional(),
  glnCodigo: glnCodigoSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
});

/** `code` no se expone editable (identidad dentro del establecimiento). */
export const roomUpdateSchema = z.object({
  id: z.string().uuid(),
  serviceUnitId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  floor: z.string().trim().max(10).nullable().optional(),
  roomType: roomTypeEnum.optional(),
  genderPolicy: roomGenderPolicyEnum.optional(),
  private: z.boolean().optional(),
  bioHazard: z.boolean().optional(),
  airConditioning: z.boolean().optional(),
  television: z.boolean().optional(),
  telephone: z.boolean().optional(),
  privateBathroom: z.boolean().optional(),
  internet: z.boolean().optional(),
  refrigerator: z.boolean().optional(),
  microwave: z.boolean().optional(),
  guestSofa: z.boolean().optional(),
  chargeCode: z.string().trim().max(40).nullable().optional(),
  invoicePolicy: roomInvoicePolicyEnum.optional(),
  glnCodigo: glnCodigoSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const roomSetActiveSchema = z.object({ id: z.string().uuid(), active: z.boolean() });

export type RoomListInput = z.infer<typeof roomListSchema>;
export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type RoomUpdateInput = z.infer<typeof roomUpdateSchema>;
export type RoomSetActiveInput = z.infer<typeof roomSetActiveSchema>;
