import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Request } from 'express';
import { Role } from '../../drizzle/admin.schema';
import { SessionUser } from './session';

// Opt OUT of authentication. The guard is global and denies by default, so a new
// route is protected unless someone deliberately writes @Public() on it.
export const PUBLIC_KEY = 'backoffice:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

// Opt IN to a stricter role. A route with no @Roles() is viewer+, i.e. anyone
// with a session — which is exactly right for the read-only screens that make up
// most of the console.
export const ROLES_KEY = 'backoffice:roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

// The session attached by JwtCookieGuard. Non-null on every non-@Public route.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.user as SessionUser;
  },
);
