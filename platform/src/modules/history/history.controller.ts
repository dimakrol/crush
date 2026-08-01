import { Controller, Get, Query } from '@nestjs/common';
import { HistoryService } from './history.service';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});

@Controller('api/history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('rounds')
  async getRounds(@Query() query: unknown) {
    const { limit } = new ZodValidationPipe(querySchema).transform(query) as {
      limit: number;
    };
    const rounds = await this.historyService.getRecentRounds(limit);
    return { data: rounds };
  }
}
