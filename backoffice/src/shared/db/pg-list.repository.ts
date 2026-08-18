import { count, eq } from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { Drizzle } from '../../config/postgres';
import { ParsedList } from '../ra/list-query';

export interface ListResult<T> {
  rows: T[];
  total: number;
}

// The read-only Postgres list resources — rounds, bets, wallet-ops — all run the
// same two queries: a total for the Content-Range header and one page of rows.
// parseListQuery (still in the controller, because the react-admin wire contract
// lives at the HTTP edge) has already whitelisted the sort column and every
// filter into `where`/`orderBy`, so this executor is handed only safe SQL.
//
// Two things this deliberately does NOT do, so the boundary stays honest: it
// never throws an HTTP error (findById returns undefined; the 404 is the
// controller's to raise) and it never reshapes a row — the numeric-string
// conversion (toDto) stays at the controller edge, as it was.
export abstract class PgListRepository<TRow> {
  protected constructor(
    protected readonly db: Drizzle,
    protected readonly table: PgTable,
    protected readonly idColumn: PgColumn,
  ) {}

  async list({
    where,
    orderBy,
    start,
    limit,
  }: ParsedList): Promise<ListResult<TRow>> {
    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(this.table)
      .where(where);
    const rows = await this.db
      .select()
      .from(this.table)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(start);
    return { rows: rows as TRow[], total: Number(total) };
  }

  async findById(id: string): Promise<TRow | undefined> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(eq(this.idColumn, id))
      .limit(1);
    return rows[0] as TRow | undefined;
  }
}
