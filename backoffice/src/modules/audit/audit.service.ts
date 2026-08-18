import { Injectable } from '@nestjs/common';
import { logger } from '../../shared/utils/logger';
import { AuditEntry, AuditRepository } from './audit.repository';

export type { AuditEntry };

@Injectable()
export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  // Called after the response has already been sent, so there is nobody left to
  // tell if this fails. A broken audit write must not take the process down —
  // but it must be loud in the logs, because a silently empty audit table is
  // worse than no audit table at all.
  record(entry: AuditEntry): void {
    try {
      this.repo.insert(entry);
    } catch (err) {
      logger.error('Failed to write audit entry', {
        action: entry.action,
        username: entry.username,
        error: (err as Error).message,
      });
    }
  }
}
