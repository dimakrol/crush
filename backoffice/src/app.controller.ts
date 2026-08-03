import { Controller, Get } from '@nestjs/common';
import { Public } from './shared/auth/auth.decorators';

@Controller('api')
export class AppController {
  // Liveness only, and deliberately outside the session — something has to
  // answer before anyone has logged in.
  //
  // Under /api, not /, because everything outside /api now belongs to the
  // console: serveClient() proxies it to Vite in development and answers it
  // with index.html in production, and both are registered ahead of this
  // router.
  @Public()
  @Get('health')
  health() {
    return { success: true };
  }
}
