import { count, eq, getTableColumns } from 'drizzle-orm';
import { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { AdminDrizzle } from '../../config/sqlite';
import { ParsedList } from '../ra/list-query';
import { ListResult } from './pg-list.repository';

// The SQLite twin of PgListRepository, for the console's own tables (users,
// audit-log). better-sqlite3 is synchronous, so these return plain values, not
// promises. Same contract otherwise: it runs the total + page queries and never
// raises an HTTP error.
//
// The projection matters here in a way it does not on the Postgres side: the
// users list must never select password_hash. A subclass passes an explicit
// column map (UsersRepository → PUBLIC_COLUMNS); when omitted, every column is
// selected, which is what the audit log wants.
export abstract class SqliteListRepository<TRow> {
  private readonly projection: Record<string, SQLiteColumn>;

  protected constructor(
    protected readonly db: AdminDrizzle,
    protected readonly table: SQLiteTable,
    protected readonly idColumn: SQLiteColumn,
    projection?: Record<string, SQLiteColumn>,
  ) {
    this.projection =
      projection ?? (getTableColumns(table) as Record<string, SQLiteColumn>);
  }

  list({ where, orderBy, start, limit }: ParsedList): ListResult<TRow> {
    const [{ value: total }] = this.db
      .select({ value: count() })
      .from(this.table)
      .where(where)
      .all();
    const rows = this.db
      .select(this.projection)
      .from(this.table)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(start)
      .all();
    return { rows: rows as TRow[], total: Number(total) };
  }

  findById(id: string): TRow | undefined {
    return this.db
      .select(this.projection)
      .from(this.table)
      .where(eq(this.idColumn, id))
      .get() as TRow | undefined;
  }
}
