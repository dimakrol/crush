import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import { LoginDto, loginSchema } from './auth.dto';
import { AuthService, LoginResult } from './auth.service';

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
}
