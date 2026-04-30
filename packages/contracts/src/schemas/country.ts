import { z } from "zod";

export const countrySchema = z.object({
  id: z.string().uuid(),
  isoAlpha3: z.string().length(3),
  isoNumeric: z.number().int(),
  name: z.string(),
  defaultLocale: z.string(),
  defaultTzId: z.string(),
  active: z.boolean(),
});

export type CountryDTO = z.infer<typeof countrySchema>;
