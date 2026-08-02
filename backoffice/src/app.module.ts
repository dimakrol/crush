import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './shared/errors/error.filter';
import {AppController} from "@/app.controller";

// Feature modules (auth, users, audit, rounds, bets, wallet-ops, engine,
// dashboard) are added in the later phases; the skeleton only wires the
// cross-cutting error filter.
@Module({
  imports: [],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
  controllers: [AppController]
})
export class AppModule {}
