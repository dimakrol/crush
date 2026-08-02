import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { EngineController } from './engine.controller';

@Module({
  imports: [PlatformModule],
  controllers: [EngineController],
})
export class EngineModule {}
