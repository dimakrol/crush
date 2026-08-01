import {
  Body,
  Controller,
  Inject,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';
import { AdminKeyGuard } from '@/shared/guards/admin-key.guard';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import {
  IWalletOpsRepository,
  WALLET_OPS_REPOSITORY,
} from './wallet-ops.repository.interface';

const retrySchema = z
  .object({ txRef: z.string().min(1).optional() })
  .default({});

type RetryDto = z.infer<typeof retrySchema>;

// Operator recovery surface for money moves the worker gave up on. Safe to hit
// repeatedly: every op is keyed by an idempotent txRef, so a replay of a move
// that actually landed returns the operator's original result without moving
// money again.
@Controller('api/admin/wallet-ops')
@UseGuards(AdminKeyGuard)
export class WalletOpsController {
  constructor(
    @Inject(WALLET_OPS_REPOSITORY)
    private readonly walletOpsRepo: IWalletOpsRepository,
  ) {}

  // Body `{ txRef }` retries one op; an empty body retries every FAILED op.
  @Post('retry')
  @UsePipes(new ZodValidationPipe(retrySchema))
  async retry(@Body() body: RetryDto) {
    if (body.txRef) {
      // Report precisely instead of silently reviving nothing: "no such op" and
      // "already in flight" are very different answers for whoever is on call.
      const op = await this.walletOpsRepo.findByTxRef(body.txRef);
      if (!op) {
        throw new AppError(
          404,
          ErrorCode.NOT_FOUND,
          `No wallet op with txRef ${body.txRef}`,
        );
      }
      if (op.state !== 'FAILED') {
        throw new AppError(
          409,
          ErrorCode.VALIDATION_ERROR,
          `Wallet op ${body.txRef} is ${op.state}; only FAILED ops can be retried`,
        );
      }
    }

    const txRefs = await this.walletOpsRepo.revive(body.txRef);
    return { data: { retried: txRefs.length, txRefs } };
  }
}
