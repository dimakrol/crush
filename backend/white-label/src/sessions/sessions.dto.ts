import { z } from 'zod';

export const launchSchema = z.object({
  gameId: z.string().min(1).optional(),
});
export type LaunchDto = z.infer<typeof launchSchema>;

export const authenticateSchema = z.object({
  token: z.string().min(1),
});
export type AuthenticateDto = z.infer<typeof authenticateSchema>;
