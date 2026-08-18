import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditGuard } from './audit.guard';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

// Global: AuditGuard is registered as an application-wide guard in AppModule,
// which means Nest resolves it from the root injector and its dependency has to
// be visible there. AuditRepository is provided here too — its own dependency,
// SQLITE_DB, comes from the global DatabaseModule, so it resolves at the root.
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditGuard, AuditRepository],
  exports: [AuditService, AuditGuard],
})
export class AuditModule {}
