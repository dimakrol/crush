import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { getSqlite } from '../../config/sqlite';
import { auditLog } from '../../drizzle/admin.schema';
import { logger } from '../../shared/utils/logger';

export interface AuditEntry {
  userId: string;
  username: string;
  action: string;
  target: string | null;
  payload: string | null;
  result: 'ok' | 'error';
  httpStatus: number;
  error: string | null;
}

@Injectable()
export class AuditService {
  // Called after the response has already been sent, so there is nobody left to
  // tell if this fails. A broken audit write must not take the process down —
  // but it must be loud in the logs, because a silently empty audit table is
  // worse than no audit table at all.
  record(entry: AuditEntry): void {
    try {
      getSqlite()
        .insert(auditLog)
        .values({ id: randomUUID(), at: new Date(), ...entry })
        .run();
    } catch (err) {
      logger.error('Failed to write audit entry', {
        action: entry.action,
        username: entry.username,
        error: (err as Error).message,
      });
    }
  }
}
