import { Controller, Post, Get, Body, UseGuards, Req, UsePipes } from '@nestjs/common';
import { AuthService } from './auth.service';
import { launchSchema, LaunchDto } from './dto/launch.dto';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import {
  JwtAuthGuard,
  AuthenticatedRequest,
} from '@/shared/guards/jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Exchange a white-label launch token for a platform session JWT.
  @Post('launch')
  @UsePipes(new ZodValidationPipe(launchSchema))
  async launch(@Body() body: LaunchDto) {
    const result = await this.authService.launch(body.token);
    return { data: result };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthenticatedRequest) {
    const result = await this.authService.me(
      req.userId,
      req.currency,
      req.displayName,
    );
    return { data: result };
  }
}
