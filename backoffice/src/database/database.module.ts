import { Global, Module } from '@nestjs/common';
import { getDrizzle } from '../config/postgres';
import { getSqlite } from '../config/sqlite';
import { DRIZZLE_PG, SQLITE_DB } from './tokens';

// Global so every feature module can inject a database handle without importing
// this module. The factories just return the singletons opened in main.ts —
// Nest instantiates providers only after NestFactory.create(), which runs once
// connectPostgresReadonly()/openSqlite() have already succeeded, so the getters
// never throw their "not connected yet" guard here.
@Global()
@Module({
  providers: [
    { provide: DRIZZLE_PG, useFactory: () => getDrizzle() },
    { provide: SQLITE_DB, useFactory: () => getSqlite() },
  ],
  exports: [DRIZZLE_PG, SQLITE_DB],
})
export class DatabaseModule {}
