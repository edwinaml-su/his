import { z } from "zod";

export const uuid = z.string().uuid();

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const idOnlySchema = z.object({ id: uuid });

export type IdOnlyInput = z.infer<typeof idOnlySchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
