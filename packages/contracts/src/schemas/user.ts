import { z } from "zod";

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().min(2).max(200),
  active: z.boolean(),
  mfaEnabled: z.boolean(),
});

export const userCreateSchema = userSchema.pick({
  email: true,
  fullName: true,
});

export type UserDTO = z.infer<typeof userSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
