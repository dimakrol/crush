import { z } from 'zod';

// All amounts are integer minor units (e.g. cents). Positive integers only.
const amount = z.number().int().positive();

export const balanceSchema = z.object({
  playerId: z.string().min(1),
  currency: z.string().min(1),
});
export type BalanceDto = z.infer<typeof balanceSchema>;

export const debitSchema = z.object({
  playerId: z.string().min(1),
  currency: z.string().min(1),
  txRef: z.string().min(1),
  amount,
  roundId: z.string().min(1).optional(),
  slotId: z.number().int().optional(),
  gameId: z.string().min(1).optional(),
});
export type DebitDto = z.infer<typeof debitSchema>;

// Credit shares the debit shape.
export const creditSchema = debitSchema;
export type CreditDto = z.infer<typeof creditSchema>;

export const rollbackSchema = z.object({
  playerId: z.string().min(1),
  currency: z.string().min(1),
  refTxRef: z.string().min(1),
});
export type RollbackDto = z.infer<typeof rollbackSchema>;
