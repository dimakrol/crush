import { Body, Controller, Get, Post, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public } from '../../shared/auth/auth.decorators';
import {
  SESSION_COOKIE,
  SessionUser,
  sessionCookieOptions,
  signSession,
} from '../../shared/auth/session';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { logger } from '../../shared/utils/logger';
import { AuthService } from './auth.service';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

type LoginDto = z.infer<typeof loginSchema>;

// Not covered by the audit log (see AuditGuard): a login attempt carries a
// password, and the one place a plaintext password must never be written is a
// table built to be read by humans. Successes and failures are logged instead.
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.verifyCredentials(
      body.username,
      body.password,
    );
    res.cookie(SESSION_COOKIE, signSession(user), sessionCookieOptions());
    logger.info('Operator signed in', {
      username: user.username,
      role: user.role,
    });
    return { data: user };
  }

  // Public so that a session which has already expired can still be cleared —
  // a logout that answers 401 leaves the browser holding a dead cookie and the
  // UI stuck on a screen it cannot leave.
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    return { data: { ok: true } };
  }

  // react-admin's authProvider calls this for checkAuth and getPermissions, so
  // it is polled on every page load: no database read, the session carries it.
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return { data: user };
  }
}
