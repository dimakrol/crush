import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import { Response } from 'express';
import { z } from 'zod';
import { getDrizzle } from '../../config/postgres';
import {
  walletOpKind,
  walletOpState,
  walletOps,
} from '../../drizzle/platform.schema';
import { Roles } from '../../shared/auth/auth.decorators';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  assertUuid,
  contentRange,
  dateFilter,
  enumFilter,
  ListSpec,
  parseListQuery,
  stringFilter,
  uuidFilter,
} from '../../shared/ra/list-query';
import { PlatformAdminClient } from '../platform/platform-admin.client';

const SPEC: ListSpec = {
  resource: 'wallet-ops',
  sortable: {
    id: walletOps.id,
    createdAt: walletOps.createdAt,
    updatedAt: walletOps.updatedAt,
    nextAttemptAt: walletOps.nextAttemptAt,
    attempts: walletOps.attempts,
    amount: walletOps.amount,
    state: walletOps.state,
    kind: walletOps.kind,
  },
  defaultSort: { field: 'createdAt', order: 'DESC' },
  filters: {
    id: uuidFilter(walletOps.id, 'id'),
    state: enumFilter(walletOps.state, 'state', walletOpState.enumValues),
    kind: enumFilter(walletOps.kind, 'kind', walletOpKind.enumValues),
    txRef: stringFilter(walletOps.txRef, 'txRef'),
    betId: uuidFilter(walletOps.betId, 'betId'),
    roundId: uuidFilter(walletOps.roundId, 'roundId'),
    playerId: stringFilter(walletOps.playerId, 'playerId'),
    createdAt_gte: dateFilter(walletOps.createdAt, 'createdAt_gte', 'gte'),
    createdAt_lte: dateFilter(walletOps.createdAt, 'createdAt_lte', 'lte'),
  },
};

type WalletOpRow = typeof walletOps.$inferSelect;
function toDto(row: WalletOpRow) {
  return { ...row, amount: Number(row.amount) };
}

// An empty body retries every FAILED op; `{ txRef }` retries one. Both are safe
// to repeat — the platform keys each move by an idempotent txRef — but the
// operator still confirms in the UI, because "retry everything" during an
// operator outage is a different decision from retrying one stuck payout.
const retrySchema = z.object({ txRef: z.string().min(1).optional() });
type RetryDto = z.infer<typeof retrySchema>;

@Controller('api/wallet-ops')
export class WalletOpsController {
  constructor(private readonly platform: PlatformAdminClient) {}

  @Get()
  async list(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { where, orderBy, start, limit } = parseListQuery(query, SPEC);
    const db = getDrizzle();

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(walletOps)
      .where(where);
    const rows = await db
      .select()
      .from(walletOps)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(start);

    res.setHeader(
      'Content-Range',
      contentRange(SPEC.resource, start, rows.length, total),
    );
    return { data: rows.map(toDto) };
  }

  // Declared before the :id route so "retry" is never read as an id. They are
  // different verbs, so Express would not confuse them anyway; the order is
  // here to keep it that way if a GET is ever added.
  @Post('retry')
  @Roles('operator', 'admin')
  @HttpCode(200)
  async retry(@Body(new ZodValidationPipe(retrySchema)) body: RetryDto) {
    const data = await this.platform.post<{
      retried: number;
      txRefs: string[];
    }>('/api/admin/wallet-ops/retry', body);
    return { data };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const row = await getDrizzle()
      .select()
      .from(walletOps)
      .where(eq(walletOps.id, assertUuid(id)))
      .limit(1);
    if (!row.length) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `No wallet op ${id}`);
    }
    return { data: toDto(row[0]) };
  }
}
