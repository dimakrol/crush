import { z } from 'zod';

// Single-use launch token minted by the white-label lobby, delivered to the
// game frontend via the iframe URL and exchanged here for a platform session.
export const launchSchema = z.object({
  token: z.string().min(1),
});

export type LaunchDto = z.infer<typeof launchSchema>;
