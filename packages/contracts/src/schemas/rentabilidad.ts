import { z } from "zod";

/**
 * CC-0036 Ola 6 (REQ-HIS-AFIL-001 S7, US.AFIL.1.8) — Tablero de rentabilidad
 * por afiliado y ocupación de consultorios. sql/249_cc0036_tableros.sql.
 * ÚLTIMA ola del REQ-HIS-AFIL-001.
 */

export const rentabilidadTableroSchema = z
  .object({
    desde: z.string().date(),
    hasta: z.string().date(),
    establishmentId: z.string().uuid().optional(),
  })
  .refine((v) => v.hasta >= v.desde, {
    message: "hasta debe ser posterior o igual a desde.",
    path: ["hasta"],
  });

export const rentabilidadDetalleSchema = z
  .object({
    medicoAfiliadoId: z.string().uuid(),
    desde: z.string().date(),
    hasta: z.string().date(),
    establishmentId: z.string().uuid().optional(),
  })
  .refine((v) => v.hasta >= v.desde, {
    message: "hasta debe ser posterior o igual a desde.",
    path: ["hasta"],
  });

export const ocupacionConsultorioSchema = z
  .object({
    desde: z.string().date(),
    hasta: z.string().date(),
    establishmentId: z.string().uuid().optional(),
  })
  .refine((v) => v.hasta >= v.desde, {
    message: "hasta debe ser posterior o igual a desde.",
    path: ["hasta"],
  });

export type RentabilidadTableroInput = z.infer<typeof rentabilidadTableroSchema>;
export type RentabilidadDetalleInput = z.infer<typeof rentabilidadDetalleSchema>;
export type OcupacionConsultorioInput = z.infer<typeof ocupacionConsultorioSchema>;
