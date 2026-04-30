import { z } from "zod";

export const currencySchema = z.object({
  id: z.string().uuid(),
  isoCode: z.string().length(3),
  name: z.string(),
  decimals: z.number().int(),
  symbol: z.string(),
  active: z.boolean(),
});

export const exchangeRateSchema = z.object({
  fromCurrency: z.string().uuid(),
  toCurrency: z.string().uuid(),
  rateType: z.enum(["BUY", "SELL", "AVERAGE", "OFFICIAL", "FISCAL"]),
  rate: z.number().positive(),
  validFrom: z.coerce.date(),
});

export type CurrencyDTO = z.infer<typeof currencySchema>;
export type ExchangeRateDTO = z.infer<typeof exchangeRateSchema>;
