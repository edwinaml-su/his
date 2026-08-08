/**
 * CC-0015 — Tipo de cuenta del paciente (pivote de lista de precios).
 *
 * TipoCuenta determina qué ServicePriceList (sql/133) aplica a los cargos de
 * una PatientAccount: PARTICULAR → "Precios Avante Complejo Hospitalario",
 * ISBM → "PRECIOS ISBM", etc. (packages/trpc/src/routers/tipo-cuenta.router.ts).
 */
import { z } from "zod";

const code30 = z.string().trim().min(1, "Código requerido").max(30);
const nombre120 = z.string().trim().min(1, "Nombre requerido").max(120);

export const tipoCuentaListInput = z
  .object({
    activeOnly: z.boolean().optional(),
  })
  .optional();

export const tipoCuentaCreateInput = z.object({
  code: code30,
  nombre: nombre120,
  priceListId: z.string().uuid().optional(),
  insurerId: z.string().uuid().optional(),
  esParticular: z.boolean().default(false),
});

export const tipoCuentaUpdateInput = z.object({
  id: z.string().uuid(),
  code: code30.optional(),
  nombre: nombre120.optional(),
  priceListId: z.string().uuid().nullable().optional(),
  insurerId: z.string().uuid().nullable().optional(),
  esParticular: z.boolean().optional(),
});

export const tipoCuentaSetActiveInput = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export type TipoCuentaListInput = z.infer<typeof tipoCuentaListInput>;
export type TipoCuentaCreateInput = z.infer<typeof tipoCuentaCreateInput>;
export type TipoCuentaUpdateInput = z.infer<typeof tipoCuentaUpdateInput>;
export type TipoCuentaSetActiveInput = z.infer<typeof tipoCuentaSetActiveInput>;
