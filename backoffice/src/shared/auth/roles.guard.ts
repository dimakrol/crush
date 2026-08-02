import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Role } from '../../drizzle/admin.schema';
import { AppError } from '../errors/AppError';
import { ErrorCode } from '../errors/error-codes';
import { ROLES_KEY } from './auth.decorators';

// Runs after JwtCookieGuard, so req.user is set whenever a role is demanded.
// Roles are not a hierarchy here: @Roles('operator', 'admin') lists every role
// allowed. Spelling them out beats an ordered ladder — adding a fourth role
// later cannot silently widen an existing route.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const role = req.user?.role;
    if (!role || !required.includes(role)) {
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        `Requires role: ${required.join(' or ')}`,
      );
    }
    return true;
  }
}
