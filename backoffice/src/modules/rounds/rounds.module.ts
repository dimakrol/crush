import { Module } from '@nestjs/common';
import { RoundsController } from './rounds.controller';

@Module({ controllers: [RoundsController] })
export class RoundsModule {}
