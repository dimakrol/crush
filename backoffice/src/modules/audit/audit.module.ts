import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditGuard } from './audit.guard';
import { AuditService } from './audit.service';

// Global: AuditGuard is registered as an application-wide guard in AppModule,
// which means Nest resolves it from the root injector and its dependency has to
// be visible there.
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditGuard],
  exports: [AuditService, AuditGuard],
})
export class AuditModule {}
