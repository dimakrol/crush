import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { roundPhase, rounds } from '../../drizzle/platform.schema';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import {
  assertUuid,
  contentRange,
  dateFilter,
  enumFilter,
  ListSpec,
  parseListQuery,
  presenceFilter,
  uuidFilter,
} from '../../shared/ra/list-query';
import { RoundsRepository } from './rounds.repository';

// The allowed values come from the schema copy itself, so a phase added to the
// platform cannot leave a filter here silently rejecting valid rows.
const SPEC: ListSpec = {
  resource: 'rounds',
  sortable: {
    id: rounds.id,
    createdAt: rounds.createdAt,
    startedAt: rounds.startedAt,
    crashedAt: rounds.crashedAt,
    crashPoint: rounds.crashPoint,
    phase: rounds.phase,
    forcedAt: rounds.forcedAt,
  },
  defaultSort: { field: 'createdAt', order: 'DESC' },
  filters: {
    id: uuidFilter(rounds.id, 'id'),
    phase: enumFilter(rounds.phase, 'phase', roundPhase.enumValues),
    // "Which rounds did an operator end by hand?" — the question the column
    // exists to answer, asked as a yes/no rather than a date comparison.
    forced: presenceFilter(rounds.forcedAt, 'forced'),
    createdAt_gte: dateFilter(rounds.createdAt, 'createdAt_gte', 'gte'),
    createdAt_lte: dateFilter(rounds.createdAt, 'createdAt_lte', 'lte'),
  },
};

@Controller('api/rounds')
export class RoundsController {
  constructor(private readonly repo: RoundsRepository) {}

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
    return { data: rows };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const row = await this.repo.findById(assertUuid(id));
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `No round ${id}`);
    }
    return { data: row };
  }
}
