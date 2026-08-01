import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LobbyJwtGuard, LobbyRequest } from '@/auth/lobby-jwt.guard';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import { CashierDto, cashierSchema } from './cashier.dto';
import { CashierResult, CashierService } from './cashier.service';

// Player-facing cashier (lobby JWT). Amounts are integer minor units.
@UseGuards(LobbyJwtGuard)
@Controller('cashier')
export class CashierController {
  constructor(private readonly cashier: CashierService) {}

  @Post('deposit')
  @HttpCode(200)
  async deposit(
    @Req() req: LobbyRequest,
    @Body(new ZodValidationPipe(cashierSchema)) body: CashierDto,
  ): Promise<CashierResult> {
    return this.cashier.deposit(req.playerId, body.amount);
  }

  @Post('withdraw')
  @HttpCode(200)
  async withdraw(
    @Req() req: LobbyRequest,
    @Body(new ZodValidationPipe(cashierSchema)) body: CashierDto,
  ): Promise<CashierResult> {
    return this.cashier.withdraw(req.playerId, body.amount);
  }
}
