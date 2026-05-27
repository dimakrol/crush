import { Controller, Get, Post, UseGuards, Req } from '@nestjs/common'
import { WalletService } from './wallet.service'
import { JwtAuthGuard, AuthenticatedRequest } from '../../shared/guards/jwt-auth.guard'

@Controller('api/wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  async getBalance(@Req() req: AuthenticatedRequest) {
    const balance = await this.walletService.getBalance(req.userId)
    return { data: { balance } }
  }

  @Post('reset')
  async reset(@Req() req: AuthenticatedRequest) {
    const wallet = await this.walletService.reset(req.userId)
    return { data: { balance: wallet.balance } }
  }
}
