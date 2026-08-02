import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { count, eq, ne, and } from 'drizzle-orm';
import { getSqlite } from '../../config/sqlite';
import { Role, users } from '../../drizzle/admin.schema';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import { BCRYPT_ROUNDS } from '../../startup/bootstrap-admin';
import { logger } from '../../shared/utils/logger';

// Never selects password_hash. The column is written here and read only by
// AuthService's compare — nothing that can reach a response ever holds it.
export const PUBLIC_COLUMNS = {
  id: users.id,
  username: users.username,
  role: users.role,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export interface CreateUserInput {
  username: string;
  password: string;
  role: Role;
}

export interface UpdateUserInput {
  username?: string;
  password?: string;
  role?: Role;
}

@Injectable()
export class UsersService {
  find(id: string) {
    const row = getSqlite()
      .select(PUBLIC_COLUMNS)
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!row) throw new AppError(404, ErrorCode.NOT_FOUND, `No user ${id}`);
    return row;
  }

  async create(input: CreateUserInput) {
    const db = getSqlite();
    this.assertUsernameFree(input.username);

    const now = new Date();
    const row = {
      id: randomUUID(),
      username: input.username,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      role: input.role,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(users).values(row).run();
    logger.info('Operator account created', {
      username: row.username,
      role: row.role,
    });

    return this.find(row.id);
  }

  async update(id: string, input: UpdateUserInput) {
    const db = getSqlite();
    const existing = db.select().from(users).where(eq(users.id, id)).get();
    if (!existing)
      throw new AppError(404, ErrorCode.NOT_FOUND, `No user ${id}`);

    if (input.username && input.username !== existing.username) {
      this.assertUsernameFree(input.username);
    }
    // Demoting the last admin locks everyone out of user management with no way
    // back short of editing the database by hand.
    if (input.role && input.role !== 'admin' && existing.role === 'admin') {
      this.assertNotLastAdmin(id);
    }

    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.username) patch.username = input.username;
    if (input.role) patch.role = input.role;
    // Absent means "leave it alone": react-admin submits the whole record on
    // every edit, and the form has no password in it unless one was typed.
    if (input.password) {
      patch.passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    }

    db.update(users).set(patch).where(eq(users.id, id)).run();
    logger.info('Operator account updated', {
      username: input.username ?? existing.username,
      passwordChanged: Boolean(input.password),
    });

    return this.find(id);
  }

  remove(id: string, actorId: string) {
    const db = getSqlite();
    const existing = this.find(id);

    // Deleting yourself ends your own session on the next request, which reads
    // as the console breaking rather than as a deliberate act.
    if (id === actorId) {
      throw new AppError(
        409,
        ErrorCode.SELF_DELETE,
        'You cannot delete your own account',
      );
    }
    if (existing.role === 'admin') this.assertNotLastAdmin(id);

    db.delete(users).where(eq(users.id, id)).run();
    logger.warn('Operator account deleted', { username: existing.username });
    return existing;
  }

  private assertUsernameFree(username: string): void {
    const clash = getSqlite()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .get();
    if (clash) {
      throw new AppError(
        409,
        ErrorCode.USERNAME_ALREADY_EXISTS,
        `Username "${username}" is taken`,
      );
    }
  }

  // "Is there another admin besides this one?" — asked as a count of the others,
  // so it stays correct however the caller intends to change this row.
  private assertNotLastAdmin(id: string): void {
    const [{ value }] = getSqlite()
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), ne(users.id, id)))
      .all();
    if (value === 0) {
      throw new AppError(
        409,
        ErrorCode.LAST_ADMIN,
        'This is the last admin; promote another account first',
      );
    }
  }
}
