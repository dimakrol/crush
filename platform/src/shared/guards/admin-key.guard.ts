import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { env } from '@/config/env';
import { AppError } from '../errors/AppError';
import { ErrorCode } from '../errors/error-codes';

// Operator-facing endpoints are not player endpoints: they carry a static shared
// key, not a session JWT. Compared over SHA-256 digests because timingSafeEqual
// requires equal lengths — hashing first keeps the comparison constant-time
// without leaking the key length through an early return.
const digest = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-admin-key'];
    if (
      typeof provided !== 'string' ||
      !timingSafeEqual(digest(provided), digest(env.ADMIN_API_KEY))
    ) {
      throw new AppError(
        401,
        ErrorCode.UNAUTHORIZED,
        'Missing or invalid admin key',
      );
    }
    return true;
  }
}
