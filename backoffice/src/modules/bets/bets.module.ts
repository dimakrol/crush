import { Module } from '@nestjs/common';
import { BetsController } from './bets.controller';

@Module({ controllers: [BetsController] })
export class BetsModule {}
