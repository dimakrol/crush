// Driver-agnostic "unique key already exists" signal. Each repository
// implementation translates its native code into this so the service layer
// (e.g. the place-bet slot race in BetService) never inspects a Mongo error
// number or a Postgres SQLSTATE directly. Treat this as the seam: services
// catch `instanceof DuplicateKeyError`, repositories produce it.
export class DuplicateKeyError extends Error {
  constructor(message = 'Duplicate key') {
    super(message);
    this.name = 'DuplicateKeyError';
  }
}

// Mongo surfaces a duplicate-key write as error code 11000.
export function isMongoDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

// Postgres surfaces a unique-violation as SQLSTATE 23505 (a string code).
// Drizzle wraps the driver error in a DrizzleQueryError, so the original pg
// error (carrying `code`) is nested under `cause` — check both levels.
export function isPostgresUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  const causeCode = (err as { cause?: { code?: string } }).cause?.code;
  return code === '23505' || causeCode === '23505';
}
