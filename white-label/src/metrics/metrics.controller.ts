import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

// Prometheus scrape target. No global prefix and the root path is free, so
// `/metrics` is available. Deliberately NOT behind the HMAC guard (unlike the
// wallet endpoints) — it exposes no money data and is reached only from the
// internal `crush_default` network by service name.
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async index(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.metrics());
  }
}
