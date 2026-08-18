import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { betStatus, bets } from '../../drizzle/platform.schema';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import {
  assertUuid,
  contentRange,
  dateFilter,
  enumFilter,
  intFilter,
  ListSpec,
  parseListQuery,
  stringFilter,
  uuidFilter,
} from '../../shared/ra/list-query';
import { BetRow, BetsRepository } from './bets.repository';

const SPEC: ListSpec = {
  resource: 'bets',
  sortable: {
    id: bets.id,
    placedAt: bets.placedAt,
    cashedOutAt: bets.cashedOutAt,
    resolvedAt: bets.resolvedAt,
    amount: bets.amount,
    payout: bets.payout,
    status: bets.status,
    userId: bets.userId,
    slotId: bets.slotId,
  },
  defaultSort: { field: 'placedAt', order: 'DESC' },
  filters: {
    id: uuidFilter(bets.id, 'id'),
    status: enumFilter(bets.status, 'status', betStatus.enumValues),
    // A white-label player id, owned by another service: text, not uuid.
    userId: stringFilter(bets.userId, 'userId'),
    roundId: uuidFilter(bets.roundId, 'roundId'),
    slotId: intFilter(bets.slotId, 'slotId'),
    currency: stringFilter(bets.currency, 'currency'),
    placedAt_gte: dateFilter(bets.placedAt, 'placedAt_gte', 'gte'),
    placedAt_lte: dateFilter(bets.placedAt, 'placedAt_lte', 'lte'),
  },
};

// amount and payout are Postgres `numeric`, which the driver hands back as
// strings so that no precision is lost on the way out of the database. The UI
// wants to sort and total them, so they are converted here, at the edge — the
// values are money in display units, well inside what a double represents
// exactly.
function toDto(row: BetRow) {
  return { ...row, amount: Number(row.amount), payout: Number(row.payout) };
}

@Controller('api/bets')
export class BetsController {
  constructor(private readonly repo: BetsRepository) {}

  @Get()
  async list(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = parseListQuery(query, SPEC);
    const { rows, total } = await this.repo.list(parsed);

    res.setHeader(
      'Content-Range',
      contentRange(SPEC.resource, parsed.start, rows.length, total),
    );
    return { data: rows.map(toDto) };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const row = await this.repo.findById(assertUuid(id));
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `No bet ${id}`);
    }
    return { data: toDto(row) };
  }
}
