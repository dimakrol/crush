import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [PlatformModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
