import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { HmacGuard } from '@/shared/guards/hmac.guard';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import {
  BalanceDto,
  CreditDto,
  DebitDto,
  RollbackDto,
  balanceSchema,
  creditSchema,
  debitSchema,
  rollbackSchema,
} from './wallet.dto';
import { WalletService } from './wallet.service';

// Server-to-server only (HMAC-guarded). Never reachable from the browser.
@UseGuards(HmacGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Post('balance')
  @HttpCode(200)
  async balance(
    @Body(new ZodValidationPipe(balanceSchema)) body: BalanceDto,
  ): Promise<{ balance: number; currency: string }> {
    const balance = await this.wallet.getBalance(body.playerId, body.currency);
    return { balance, currency: body.currency };
  }

  @Post('debit')
  @HttpCode(200)
  async debit(
    @Body(new ZodValidationPipe(debitSchema)) body: DebitDto,
  ): Promise<{ balance: number; currency: string; txRef: string }> {
    const balance = await this.wallet.debit(body);
    return { balance, currency: body.currency, txRef: body.txRef };
  }

  @Post('credit')
  @HttpCode(200)
  async credit(
    @Body(new ZodValidationPipe(creditSchema)) body: CreditDto,
  ): Promise<{ balance: number; currency: string; txRef: string }> {
    const balance = await this.wallet.credit(body);
    return { balance, currency: body.currency, txRef: body.txRef };
  }

  @Post('rollback')
  @HttpCode(200)
  async rollback(
    @Body(new ZodValidationPipe(rollbackSchema)) body: RollbackDto,
  ): Promise<{ balance: number; currency: string; refTxRef: string }> {
    const balance = await this.wallet.rollback(body);
    return { balance, currency: body.currency, refTxRef: body.refTxRef };
  }
}
