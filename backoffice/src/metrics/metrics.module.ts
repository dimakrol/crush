import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { StuckWorkCollector } from './stuck-work.collector';

// @Global so AuditGuard and PlatformAdminClient can inject MetricsService
// without re-importing this module. The APP_INTERCEPTOR that feeds HTTP metrics
// is registered in AppModule (mirroring the existing APP_FILTER provider).
@Global()
@Module({
  providers: [MetricsService, StuckWorkCollector],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
