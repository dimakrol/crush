import { SessionUser } from '../shared/auth/session';

// Two pieces of per-request state the framework has no slot for.
declare global {
  namespace Express {
    interface Request {
      // Set by JwtCookieGuard; absent only on @Public routes and rejected ones.
      user?: SessionUser;
      // Set by GlobalExceptionFilter so AuditGuard's response listener can
      // record WHY a request failed — by then the exception itself is long gone.
      auditError?: string;
    }
  }
}

export {};
