import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { auditLog } from '../../drizzle/admin.schema';
import { Roles } from '../../shared/auth/auth.decorators';
import {
  contentRange,
  dateFilter,
  enumFilter,
  ListSpec,
  parseListQuery,
  stringFilter,
} from '../../shared/ra/list-query';
import { AuditRepository } from './audit.repository';

const SPEC: ListSpec = {
  resource: 'audit-log',
  sortable: {
    at: auditLog.at,
    username: auditLog.username,
    action: auditLog.action,
    result: auditLog.result,
    httpStatus: auditLog.httpStatus,
  },
  defaultSort: { field: 'at', order: 'DESC' },
  filters: {
    id: stringFilter(auditLog.id, 'id'),
    username: stringFilter(auditLog.username, 'username'),
    action: stringFilter(auditLog.action, 'action'),
    result: enumFilter(auditLog.result, 'result', ['ok', 'error']),
    at_gte: dateFilter(auditLog.at, 'at_gte', 'gte'),
    at_lte: dateFilter(auditLog.at, 'at_lte', 'lte'),
  },
};

// Read-only, admin-only, and there is deliberately no route that writes or
// deletes: the trail is only worth something if the people it records cannot
// edit it. Rows are written by AuditGuard alone (via AuditService).
@Controller('api/audit-log')
@Roles('admin')
export class AuditController {
  constructor(private readonly repo: AuditRepository) {}

  @Get()
  list(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = parseListQuery(query, SPEC);
    const { rows, total } = this.repo.list(parsed);

    res.setHeader(
      'Content-Range',
      contentRange(SPEC.resource, parsed.start, rows.length, total),
    );
    return { data: rows };
  }
}
