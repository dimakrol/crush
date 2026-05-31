import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { HmacGuard } from '@/shared/guards/hmac.guard';
import { PlayersService } from './players.service';

// Admin surface — HMAC-guarded, server-to-server only.
@UseGuards(HmacGuard)
@Controller('admin/players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Post(':id/reset')
  @HttpCode(200)
  async reset(
    @Param('id') id: string,
  ): Promise<{ balance: number; currency: string }> {
    return this.players.resetBalance(id);
  }
}
