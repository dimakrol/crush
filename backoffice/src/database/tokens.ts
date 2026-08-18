// DI tokens for the two database handles. The connections themselves are still
// opened imperatively in main.ts, before NestFactory (the boot order — role,
// then schema check, then the long-lived pool — is part of the security design
// and must not move into Nest's lifecycle). These providers are a thin bridge:
// the factories in database.module.ts run after that boot has finished, so they
// hand repositories the already-connected singleton through normal constructor
// injection instead of a module-level getter.
export const DRIZZLE_PG = Symbol('DRIZZLE_PG');
export const SQLITE_DB = Symbol('SQLITE_DB');
