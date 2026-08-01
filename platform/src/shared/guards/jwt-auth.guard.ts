import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { AppError } from '../errors/AppError';
import { ErrorCode } from '../errors/error-codes';

export interface AuthenticatedRequest extends Request {
  userId: string;
  currency: string;
  sessionId: string;
  displayName: string;
}

interface PlatformJwtPayload {
  sub: string;
  currency: string;
  sessionId: string;
  displayName: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(
        401,
        ErrorCode.UNAUTHORIZED,
        'Missing or invalid authorization header',
      );
    }
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(
        token,
        env.JWT_ACCESS_SECRET,
      ) as PlatformJwtPayload;
      req.userId = payload.sub;
      req.currency = payload.currency;
      req.sessionId = payload.sessionId;
      req.displayName = payload.displayName;
      return true;
    } catch {
      throw new AppError(
        401,
        ErrorCode.UNAUTHORIZED,
        'Invalid or expired token',
      );
    }
  }
}
