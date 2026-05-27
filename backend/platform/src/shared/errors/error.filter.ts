import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common'
import { Response } from 'express'
import { AppError } from './AppError'
import { ErrorCode } from './error-codes'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()

    if (exception instanceof AppError) {
      res.status(exception.statusCode).json({
        error: { code: exception.code, message: exception.message },
      })
      return
    }

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({
        error: { code: ErrorCode.VALIDATION_ERROR, message: exception.message },
      })
      return
    }

    console.error('Unhandled error:', exception)
    res.status(500).json({
      error: { code: ErrorCode.INTERNAL_SERVER_ERROR, message: 'Internal server error' },
    })
  }
}
