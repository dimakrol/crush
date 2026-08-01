import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';
import { LobbyJwtPayload } from './auth.service';

export interface LobbyRequest extends Request {
  playerId: string;
  displayName: string;
}

// Verifies the lobby player's session JWT and attaches identity to the request.
@Injectable()
export class LobbyJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<LobbyRequest>();
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Missing bearer token');
    }

    try {
      const payload = jwt.verify(
        header.slice(7),
        env.LOBBY_JWT_SECRET,
      ) as LobbyJwtPayload;
      req.playerId = payload.sub;
      req.displayName = payload.displayName;
      return true;
    } catch {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Invalid session token');
    }
  }
}
