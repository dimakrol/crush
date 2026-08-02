import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

// The backoffice's OWN store — the only tables this project may create or
// migrate. Everything about the game lives in the platform's Postgres and is
// read-only here (platform.schema.ts).
//
// SQLite because the data is tiny, single-writer and operational: a handful of
// operator accounts and the trail of what they did. It also keeps the service
// standalone — the backoffice must still let you log in and read the audit log
// when the platform's database is the thing that is broken.

export const ROLES = ['viewer', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull().unique(),
    // bcrypt hash. The plaintext never leaves the login request.
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<Role>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  () => [
    // The role decides who can move money. A typo that writes 'Admin' or
    // 'operatorr' must fail at the write, not silently lock someone out of the
    // actions they were granted — or, worse, past a guard that string-matches.
    check('users_role_valid', sql`"role" IN ('viewer', 'operator', 'admin')`),
  ],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    at: integer('at', { mode: 'timestamp' }).notNull(),
    // No foreign key to users, on purpose: the trail must outlive the account.
    // An FK would force a choice between blocking deletion and nulling the id,
    // and both lose evidence. `username` is denormalized for the same reason —
    // it records who they were at the time, not who owns that name today.
    userId: text('user_id').notNull(),
    username: text('username').notNull(),
    // What was attempted, e.g. 'engine.pause' / 'round.forceCrash'.
    action: text('action').notNull(),
    // What it was aimed at: a round id, a txRef, a user id — free-form.
    target: text('target'),
    // Request body as JSON text. SQLite has no json type; this is never queried
    // by content, only read back on the audit screen.
    payload: text('payload'),
    result: text('result').$type<'ok' | 'error'>().notNull(),
    // Status returned to the operator. For a proxied action this is the
    // platform's status, which is how a refusal by the platform stays visible.
    httpStatus: integer('http_status').notNull(),
    error: text('error'),
  },
  (t) => [
    // The audit screen is always "most recent first", optionally per operator.
    index('audit_log_at_idx').on(t.at),
    index('audit_log_user_idx').on(t.userId),
    check('audit_log_result_valid', sql`"result" IN ('ok', 'error')`),
  ],
);
