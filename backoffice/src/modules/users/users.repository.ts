import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, ne } from 'drizzle-orm';
import { AdminDrizzle } from '../../config/sqlite';
import { SQLITE_DB } from '../../database/tokens';
import { users } from '../../drizzle/admin.schema';
import { SqliteListRepository } from '../../shared/db/sqlite-list.repository';

// Never selects password_hash. The column is written here and read only by
// findByUsernameWithHash (which AuthService's compare calls) — nothing that can
// reach a response ever holds it.
export const PUBLIC_COLUMNS = {
  id: users.id,
  username: users.username,
  role: users.role,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export type PublicUser = {
  id: string;
  username: string;
  role: (typeof users.$inferSelect)['role'];
  createdAt: Date;
  updatedAt: Date;
};

type FullUser = typeof users.$inferSelect;
type NewUser = typeof users.$inferInsert;

// Every query against the console's `users` table lives here. list/findById come
// from the base with the public projection, so neither can leak the hash; the
// one method that does read it is named for exactly that. No method throws an
// HTTP error — the 404s, 409s and the last-admin rule live in UsersService.
@Injectable()
export class UsersRepository extends SqliteListRepository<PublicUser> {
  constructor(@Inject(SQLITE_DB) db: AdminDrizzle) {
    super(db, users, users.id, PUBLIC_COLUMNS);
  }

  findByUsername(username: string): PublicUser | undefined {
    return this.db
      .select(PUBLIC_COLUMNS)
      .from(users)
      .where(eq(users.username, username))
      .get();
  }

  // The single read that includes the hash, for credential verification.
  findByUsernameWithHash(username: string): FullUser | undefined {
    return this.db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .get();
  }

  insert(row: NewUser): void {
    this.db.insert(users).values(row).run();
  }

  update(id: string, patch: Partial<NewUser>): void {
    this.db.update(users).set(patch).where(eq(users.id, id)).run();
  }

  delete(id: string): void {
    this.db.delete(users).where(eq(users.id, id)).run();
  }

  // "Is there another admin besides this one?" — asked as a count of the others,
  // so it stays correct however the caller intends to change this row.
  countOtherAdmins(excludeId: string): number {
    const [{ value }] = this.db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), ne(users.id, excludeId)))
      .all();
    return value;
  }
}
