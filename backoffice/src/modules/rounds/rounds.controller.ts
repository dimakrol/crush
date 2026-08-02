import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import { Response } from 'express';
import { getDrizzle } from '../../config/postgres';
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
  @Get()
  async list(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { where, orderBy, start, limit } = parseListQuery(query, SPEC);
    const db = getDrizzle();

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(rounds)
      .where(where);
    const rows = await db
      .select()
      .from(rounds)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(start);

    res.setHeader(
      'Content-Range',
      contentRange(SPEC.resource, start, rows.length, total),
    );
    return { data: rows };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const row = await getDrizzle()
      .select()
      .from(rounds)
      .where(eq(rounds.id, assertUuid(id)))
      .limit(1);
    if (!row.length) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `No round ${id}`);
    }
    return { data: row[0] };
  }
}
