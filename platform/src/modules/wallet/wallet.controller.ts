import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { WalletService } from './wallet.service';
import {
  JwtAuthGuard,
  AuthenticatedRequest,
} from '@/shared/guards/jwt-auth.guard';

@Controller('api/wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  // Live balance from the white-label for the authenticated session's currency.
  @Get()
  async getBalance(@Req() req: AuthenticatedRequest) {
    const balance = await this.walletService.getBalance(
      req.userId,
      req.currency,
    );
    return { data: { balance } };
  }
}
