import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

// Feeds the HTTP RED histogram. Registered once as an APP_INTERCEPTOR, it only
// sees requests that reach Nest — i.e. `/api/*` and the metrics route. The SPA
// and Vite proxy run as Express middleware ahead of Nest's router, so non-/api
// traffic never reaches here, which is exactly what we want measured.
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<{
      method: string;
      route?: { path?: string };
    }>();
    const res = http.getResponse<{ statusCode: number }>();
    const route = this.routeOf(context, req);

    // The scrape endpoint itself would only add self-noise to the RED panels.
    if (route === '/api/metrics') return next.handle();

    const endTimer = this.metrics.startHttpTimer();
    const stop = (status: number) =>
      endTimer({ method: req.method, route, status_code: status });

    return next.handle().pipe(
      tap({
        next: () => stop(res.statusCode),
        // On error the response status is not set yet (the exception filter runs
        // later), so read it off the thrown AppError/HttpException instead.
        error: (err: { status?: number; statusCode?: number }) =>
          stop(err?.status ?? err?.statusCode ?? 500),
      }),
    );
  }

  // Prefer the matched Express route pattern (path params collapse to :id, so
  // cardinality stays bounded); fall back to Controller.handler for unmatched
  // paths (e.g. 404s).
  private routeOf(
    context: ExecutionContext,
    req: { route?: { path?: string } },
  ): string {
    return (
      req.route?.path ??
      `${context.getClass().name}.${context.getHandler().name}`
    );
  }
}
