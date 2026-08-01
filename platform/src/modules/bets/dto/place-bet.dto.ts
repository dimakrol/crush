import { z } from 'zod';

export const placeBetSchema = z.object({
  slotId: z.union([z.literal(1), z.literal(2)]),
  amount: z.number().positive(),
  autoCashOut: z.number().gt(1).nullable().optional().default(null),
});

export type PlaceBetDto = z.infer<typeof placeBetSchema>;
