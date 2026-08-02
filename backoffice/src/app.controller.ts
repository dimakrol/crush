import { Controller, Get } from '@nestjs/common';
import { Public } from './shared/auth/auth.decorators';

@Controller()
export class AppController {
  // Liveness only, and deliberately outside the session — something has to
  // answer before anyone has logged in. Phase 5 replaces this route with the
  // SPA fallback.
  @Public()
  @Get()
  index() {
    return { success: true };
  }
}
