import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LobbyJwtGuard, LobbyRequest } from '@/auth/lobby-jwt.guard';
import { env } from '@/config/env';
import { HmacGuard } from '@/shared/guards/hmac.guard';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import {
  AuthenticateDto,
  LaunchDto,
  authenticateSchema,
  launchSchema,
} from './sessions.dto';
import {
  AuthenticateResult,
  LaunchResult,
  SessionsService,
} from './sessions.service';

@Controller()
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  // Lobby player mints a launch token for the iframe (lobby JWT required).
  @UseGuards(LobbyJwtGuard)
  @Post('sessions/launch')
  @HttpCode(200)
  async launch(
    @Req() req: LobbyRequest,
    @Body(new ZodValidationPipe(launchSchema)) body: LaunchDto,
  ): Promise<LaunchResult> {
    return this.sessions.launch(req.playerId, body.gameId ?? env.GAME_ID);
  }

  // Platform exchanges the launch token for identity + balance (HMAC, S2S).
  @UseGuards(HmacGuard)
  @Post('wallet/authenticate')
  @HttpCode(200)
  async authenticate(
    @Body(new ZodValidationPipe(authenticateSchema)) body: AuthenticateDto,
  ): Promise<AuthenticateResult> {
    return this.sessions.authenticate(body.token);
  }
}
