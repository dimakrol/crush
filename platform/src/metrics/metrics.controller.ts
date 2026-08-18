import { Controller, Get, Res } from '@nestjs/common'
import { Response } from 'express'
import { MetricsService } from './metrics.service'

// Prometheus scrape target. No global prefix on this service and the root path
// is free, so `/metrics` (the de-facto convention) is available. Unauthenticated
// by design — reached only from the internal `crush_default` network by name.
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async index(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType)
    res.send(await this.metrics.metrics())
  }
}
