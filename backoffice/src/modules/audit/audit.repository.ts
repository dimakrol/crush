import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminDrizzle } from '../../config/sqlite';
import { SQLITE_DB } from '../../database/tokens';
import { auditLog } from '../../drizzle/admin.schema';
import { SqliteListRepository } from '../../shared/db/sqlite-list.repository';

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

type AuditRow = typeof auditLog.$inferSelect;

// The audit table's data access. Reads come from the base list executor (the
// controller passes the parsed query); the single write is here too, so the one
// place a row is inserted and the one place they are read share an owner. The
// try/catch that must not take the process down lives in AuditService, which
// calls insert().
@Injectable()
export class AuditRepository extends SqliteListRepository<AuditRow> {
  constructor(@Inject(SQLITE_DB) db: AdminDrizzle) {
    super(db, auditLog, auditLog.id);
  }

  insert(entry: AuditEntry): void {
    this.db
      .insert(auditLog)
      .values({ id: randomUUID(), at: new Date(), ...entry })
      .run();
  }
}
