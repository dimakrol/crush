import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '@/shared/auth/auth.decorators';
import { MetricsService } from './metrics.service';

// Prometheus scrape target. Under `/api` on purpose: the root and everything
// outside `/api` belong to the SPA (serveClient() answers non-/api paths with
// index.html / the Vite proxy), so a root `/metrics` would return HTML. `/api/*`
// is the only prefix that reaches Nest.
//
// @Public() is mandatory: the global guards deny by default, so without it the
// JwtCookieGuard would answer the scraper with 401. It exposes no session data
// and is reached only from the internal `crush_default` network by service name.
@Controller('api')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get('metrics')
  async index(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.metrics());
  }
}
