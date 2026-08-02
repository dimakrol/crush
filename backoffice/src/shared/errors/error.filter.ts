import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError } from './AppError';
import { ErrorCode } from './error-codes';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    // Every failure funnels through here, which makes it the only place that
    // can tell AuditGuard's response listener why a request failed — the
    // exception is gone by the time the listener runs.
    ctx.getRequest<Request>().auditError =
      exception instanceof Error ? exception.message : String(exception);

    if (exception instanceof AppError) {
      res.status(exception.statusCode).json({
        error: { code: exception.code, message: exception.message },
      });
      return;
    }

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({
        error: { code: ErrorCode.VALIDATION_ERROR, message: exception.message },
      });
      return;
    }

    console.error('Unhandled error:', exception);
    res.status(500).json({
      error: {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      },
    });
  }
}
