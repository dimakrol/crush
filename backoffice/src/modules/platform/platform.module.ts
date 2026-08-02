import { Module } from '@nestjs/common';
import { PlatformAdminClient } from './platform-admin.client';

@Module({
  providers: [PlatformAdminClient],
  exports: [PlatformAdminClient],
})
export class PlatformModule {}
