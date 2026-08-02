import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { count } from 'drizzle-orm';
import { getSqlite } from '../config/sqlite';
import { users } from '../drizzle/admin.schema';
import { env } from '../config/env';
import { logger } from '../shared/utils/logger';

// Cost 12: a login is a once-per-shift operation on a console with a handful of
// accounts, so ~250 ms of hashing is invisible to the operator and expensive for
// anyone working through a stolen database file.
export const BCRYPT_ROUNDS = 12;

// Creates the first admin, and only the first. The condition is "the users table
// is empty", not "no user named BACKOFFICE_ADMIN_USER": that is what makes it
// safe to leave the credentials in the environment forever. Renaming the account
// or changing its password through the UI survives every restart, and deleting
// the last admin is refused by the API (ErrorCode.LAST_ADMIN), so this can never
// silently resurrect a revoked account.
export async function bootstrapAdmin(): Promise<void> {
  const db = getSqlite();
  const [{ value }] = db.select({ value: count() }).from(users).all();
  if (value > 0) return;

  const passwordHash = await bcrypt.hash(
    env.BACKOFFICE_ADMIN_PASSWORD,
    BCRYPT_ROUNDS,
  );
  const now = new Date();

  db.insert(users)
    .values({
      id: randomUUID(),
      username: env.BACKOFFICE_ADMIN_USER,
      passwordHash,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  logger.warn(
    `Created first admin "${env.BACKOFFICE_ADMIN_USER}" from the environment — change the password after the first login`,
  );
}
