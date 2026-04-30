import { z } from "zod";

export const organizationSchema = z.object({
  id: z.string().uuid(),
  countryId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  legalName: z.string().min(2).max(200),
  tradeName: z.string().max(200).nullable(),
  taxId: z.string().min(2).max(40),
  functionalCurrency: z.string().uuid(),
  reportingCurrency: z.string().uuid().nullable(),
  active: z.boolean(),
});

export const organizationCreateSchema = organizationSchema.pick({
  countryId: true,
  parentId: true,
  legalName: true,
  tradeName: true,
  taxId: true,
  functionalCurrency: true,
  reportingCurrency: true,
});

export type OrganizationDTO = z.infer<typeof organizationSchema>;
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;
