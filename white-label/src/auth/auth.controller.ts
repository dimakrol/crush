import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LobbyJwtGuard, LobbyRequest } from './lobby-jwt.guard';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import { LoginDto, loginSchema } from './auth.dto';
import { AuthService, LobbyPlayerSession, LoginResult } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
  ): Promise<LoginResult> {
    return this.auth.login(body);
  }

  @UseGuards(LobbyJwtGuard)
  @Get('me')
  async me(@Req() req: LobbyRequest): Promise<LobbyPlayerSession> {
    return this.auth.me(req.playerId);
  }
}
