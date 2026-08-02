import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { getSqlite } from '../../config/sqlite';
import { users } from '../../drizzle/admin.schema';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import { SessionUser } from '../../shared/auth/session';
import { BCRYPT_ROUNDS } from '../../startup/bootstrap-admin';

// A hash of a value nobody knows, compared against when the username does not
// exist. Without it "no such user" answers in a millisecond and "wrong password"
// in ~250ms, which is a reliable oracle for enumerating operator accounts. Hashed
// at load rather than pasted in as a literal — the same cost as a real password,
// and it cannot be a typo'd string that bcrypt rejects outright (which would
// return instantly and reopen the timing gap it exists to close).
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), BCRYPT_ROUNDS);

@Injectable()
export class AuthService {
  async verifyCredentials(
    username: string,
    password: string,
  ): Promise<SessionUser> {
    const db = getSqlite();
    const row = db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .get();

    const ok = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_HASH);
    // One message for both failures: telling the caller which half was wrong is
    // the whole enumeration problem again, just spelled out.
    if (!row || !ok) {
      throw new AppError(
        401,
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid username or password',
      );
    }

    return { id: row.id, username: row.username, role: row.role };
  }
}
