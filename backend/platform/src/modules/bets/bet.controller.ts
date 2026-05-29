import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
  Query,
  UsePipes,
} from '@nestjs/common';
import { BetService } from './bet.service';
import { placeBetSchema, PlaceBetDto } from './dto/place-bet.dto';
import {
  JwtAuthGuard,
  AuthenticatedRequest,
} from '@/shared/guards/jwt-auth.guard';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import { getRedis } from '@/config/redis';
import { z } from 'zod';

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});

@Controller('api/bets')
@UseGuards(JwtAuthGuard)
export class BetController {
  constructor(private readonly betService: BetService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(placeBetSchema))
  async placeBet(@Body() body: PlaceBetDto, @Req() req: AuthenticatedRequest) {
    const result = await this.betService.placeBet(
      req.userId,
      body.slotId,
      body.amount,
      body.autoCashOut ?? null,
    );
    return { data: result };
  }

  @Post(':betId/cashout')
  async cashOut(
    @Param('betId') betId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.betService.cashOut(req.userId, betId);
    return { data: result };
  }

  @Get('active')
  async getActive(@Req() req: AuthenticatedRequest) {
    const roundId = await getRedis().get('game:currentRound');
    const bets = roundId
      ? await this.betService.getActiveBets(req.userId, roundId)
      : [];
    return { data: bets };
  }

  @Get('history')
  async getHistory(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const { limit, cursor } = new ZodValidationPipe(
      historyQuerySchema,
    ).transform(query) as { limit: number; cursor?: string };
    const result = await this.betService.getBetHistory(
      req.userId,
      limit,
      cursor,
    );
    return {
      data: result.bets,
      meta: { limit, nextCursor: result.nextCursor },
    };
  }
}
