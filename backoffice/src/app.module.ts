import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from '@/app.controller';
import { AuditGuard } from './modules/audit/audit.guard';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BetsModule } from './modules/bets/bets.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EngineModule } from './modules/engine/engine.module';
import { PlatformModule } from './modules/platform/platform.module';
import { RoundsModule } from './modules/rounds/rounds.module';
import { UsersModule } from './modules/users/users.module';
import { WalletOpsModule } from './modules/wallet-ops/wallet-ops.module';
import { JwtCookieGuard } from './shared/auth/jwt-cookie.guard';
import { RolesGuard } from './shared/auth/roles.guard';
import { GlobalExceptionFilter } from './shared/errors/error.filter';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    PlatformModule,
    RoundsModule,
    BetsModule,
    WalletOpsModule,
    EngineModule,
    DashboardModule,
    UsersModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // The order of these three is the whole access-control design:
    //
    //   AuditGuard     authorizes nothing — it only attaches a response
    //                  listener. First, so that what the two guards below turn
    //                  away is still recorded (see audit.guard.ts).
    //   JwtCookieGuard deny-by-default authentication; @Public() opts out.
    //   RolesGuard     reads @Roles(); a route without one is viewer+.
    { provide: APP_GUARD, useClass: AuditGuard },
    { provide: APP_GUARD, useClass: JwtCookieGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  controllers: [AppController],
})
export class AppModule {}
