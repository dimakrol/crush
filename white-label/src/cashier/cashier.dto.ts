import { z } from 'zod';

// Player-facing cashier amounts are integer minor units (e.g. cents), positive.
export const cashierSchema = z.object({
  amount: z.number().int().positive(),
});
export type CashierDto = z.infer<typeof cashierSchema>;
