import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';
import { verify } from '@/shared/utils/hmac';

const MAX_SKEW_MS = 30_000;

// Guards the server-to-server wallet API. Verifies the API key, the request
// signature (over `timestamp + rawBody`), and rejects stale timestamps (replay).
// Requires the app to be created with `{ rawBody: true }` so `req.rawBody` exists.
@Injectable()
export class HmacGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { rawBody?: Buffer }>();

    const apiKey = req.header('x-api-key');
    const timestamp = req.header('x-timestamp');
    const signature = req.header('x-signature');

    if (!apiKey || !timestamp || !signature) {
      throw new AppError(
        401,
        ErrorCode.INVALID_SIGNATURE,
        'Missing authentication headers',
      );
    }

    if (apiKey !== env.OPERATOR_API_KEY) {
      throw new AppError(401, ErrorCode.INVALID_SIGNATURE, 'Invalid API key');
    }

    const skew = Math.abs(Date.now() - Number(timestamp));
    if (!Number.isFinite(skew) || skew > MAX_SKEW_MS) {
      throw new AppError(
        401,
        ErrorCode.INVALID_SIGNATURE,
        'Request timestamp out of range',
      );
    }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
    if (!verify(env.OPERATOR_SECRET, timestamp, rawBody, signature)) {
      throw new AppError(401, ErrorCode.INVALID_SIGNATURE, 'Invalid signature');
    }

    return true;
  }
}
