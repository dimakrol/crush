import { Injectable } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Role } from '../../drizzle/admin.schema';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import { logger } from '../../shared/utils/logger';
import { BCRYPT_ROUNDS } from '../../startup/bootstrap-admin';
import { PublicUser, UsersRepository } from './users.repository';

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

// The business rules of operator accounts — uniqueness, the last-admin
// guarantee, hashing. Every query it needs is delegated to UsersRepository; this
// layer only decides and raises the HTTP errors the repository refuses to know
// about.
@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  find(id: string): PublicUser {
    const row = this.users.findById(id);
    if (!row) throw new AppError(404, ErrorCode.NOT_FOUND, `No user ${id}`);
    return row;
  }

  async create(input: CreateUserInput): Promise<PublicUser> {
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
    this.users.insert(row);
    logger.info('Operator account created', {
      username: row.username,
      role: row.role,
    });

    return this.find(row.id);
  }

  async update(id: string, input: UpdateUserInput): Promise<PublicUser> {
    const existing = this.find(id);

    if (input.username && input.username !== existing.username) {
      this.assertUsernameFree(input.username);
    }
    // Demoting the last admin locks everyone out of user management with no way
    // back short of editing the database by hand.
    if (input.role && input.role !== 'admin' && existing.role === 'admin') {
      this.assertNotLastAdmin(id);
    }

    const patch: {
      updatedAt: Date;
      username?: string;
      role?: Role;
      passwordHash?: string;
    } = { updatedAt: new Date() };
    if (input.username) patch.username = input.username;
    if (input.role) patch.role = input.role;
    // Absent means "leave it alone": react-admin submits the whole record on
    // every edit, and the form has no password in it unless one was typed.
    if (input.password) {
      patch.passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    }

    this.users.update(id, patch);
    logger.info('Operator account updated', {
      username: input.username ?? existing.username,
      passwordChanged: Boolean(input.password),
    });

    return this.find(id);
  }

  remove(id: string, actorId: string): PublicUser {
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

    this.users.delete(id);
    logger.warn('Operator account deleted', { username: existing.username });
    return existing;
  }

  private assertUsernameFree(username: string): void {
    if (this.users.findByUsername(username)) {
      throw new AppError(
        409,
        ErrorCode.USERNAME_ALREADY_EXISTS,
        `Username "${username}" is taken`,
      );
    }
  }

  private assertNotLastAdmin(id: string): void {
    if (this.users.countOtherAdmins(id) === 0) {
      throw new AppError(
        409,
        ErrorCode.LAST_ADMIN,
        'This is the last admin; promote another account first',
      );
    }
  }
}
