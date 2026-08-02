import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AppError } from '../errors/AppError';
import { ErrorCode } from '../errors/error-codes';
import { PUBLIC_KEY } from './auth.decorators';
import { SESSION_COOKIE, verifySession } from './session';

// Global, deny-by-default. Registered in AppModule rather than route by route
// so that forgetting it on a new controller is impossible — the failure mode of
// a per-route guard is an unprotected endpoint nobody notices.
@Injectable()
export class JwtCookieGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const user = token ? verifySession(token) : null;
    if (!user) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Not signed in');
    }

    req.user = user;
    return true;
  }
}
