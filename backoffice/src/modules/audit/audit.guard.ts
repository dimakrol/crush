import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuditService } from './audit.service';

// Every state-changing request to /api, recorded whatever the outcome.
//
// Why a guard and not an interceptor, which is what this obviously is: Nest runs
// guards BEFORE interceptors, so an interceptor never sees a request that
// JwtCookieGuard or RolesGuard turned away. A viewer trying to force-crash a
// round is precisely the event an audit log exists to capture, and it would be
// the one event missing. Registered first among the global guards, this observes
// everything and authorizes nothing — it always returns true.
//
// The row is written from a response listener rather than inline, so the status
// it records is the real one the operator received: a 403 from a later guard, a
// 409 forwarded from the platform, or a 500 from an unhandled bug.

const ANONYMOUS = 'anonymous';
const MAX_PAYLOAD_CHARS = 2000;
const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Anything that smells like a credential is replaced, not stored. /api/auth is
// skipped entirely (a login body is a password), but a users.create body also
// carries one and that route very much needs auditing.
const SECRET_KEY = /password|secret|token|key/i;

@Injectable()
export class AuditGuard implements CanActivate {
  constructor(private readonly audit: AuditService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    if (!isAuditable(req)) return true;

    const res = http.getResponse<Response>();
    // Captured now, while the request is being dispatched: by the time the
    // listener runs, Express may have unwound the route layer that populated
    // req.params.
    const route = (req.route as { path?: string } | undefined)?.path;
    const action = deriveAction(req.method, route ?? req.path);
    const target = deriveTarget(req);
    const payload = redactPayload(req.body);

    let written = false;
    const write = () => {
      if (written) return;
      written = true;
      const status = res.statusCode;
      this.audit.record({
        // req.user is filled in by JwtCookieGuard, which runs after this one —
        // read late, inside the listener, so it is there by then. Still absent
        // on a 401, where recording the attempt matters more than the name.
        userId: req.user?.id ?? ANONYMOUS,
        username: req.user?.username ?? ANONYMOUS,
        action,
        target,
        payload,
        result: status < 400 ? 'ok' : 'error',
        httpStatus: status,
        error: req.auditError ?? null,
      });
    };

    // 'finish' is the normal path; 'close' catches a client that hung up after
    // the action had already been carried out — the least excusable moment to
    // have no record of it.
    res.on('finish', write);
    res.on('close', write);
    return true;
  }
}

function isAuditable(req: Request): boolean {
  if (!AUDITED_METHODS.has(req.method)) return false;
  const path = req.path;
  if (!path.startsWith('/api/')) return false;
  // Login and logout are excluded: the body is a password and the outcome is
  // already in the service log.
  return !path.startsWith('/api/auth/');
}

// A stable name derived from the route, never from a decorator — an action you
// have to remember to annotate is an action that eventually is not audited.
//
// The rule: take the static segments after /api and join them with dots. If
// there is only one (`/api/users`, `/api/users/:id`), the segment names a
// resource rather than an operation, so the HTTP verb supplies the operation:
// users.create / users.update / users.delete. Two or more segments already name
// one: engine.pause, wallet-ops.retry, engine.force-crash.
const VERBS: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

export function deriveAction(method: string, routePath: string): string {
  const statics = routePath
    .split('/')
    .filter(Boolean)
    .filter((s) => s !== 'api' && !s.startsWith(':') && !s.startsWith('*'));

  const parts =
    statics.length <= 1 && VERBS[method]
      ? [...statics, VERBS[method]]
      : statics;
  return parts.join('.') || method.toLowerCase();
}

// What the action was aimed at. The path id covers the CRUD routes; txRef covers
// the one action whose subject travels in the body.
function deriveTarget(req: Request): string | null {
  const id = req.params?.id;
  if (typeof id === 'string' && id) return id;
  const txRef = (req.body as { txRef?: unknown } | undefined)?.txRef;
  if (typeof txRef === 'string' && txRef) return txRef;
  return null;
}

function redactPayload(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const entries = Object.entries(body as Record<string, unknown>);
  if (!entries.length) return null;

  const safe: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    safe[key] = SECRET_KEY.test(key) ? '[redacted]' : value;
  }

  const json = JSON.stringify(safe);
  return json.length > MAX_PAYLOAD_CHARS
    ? `${json.slice(0, MAX_PAYLOAD_CHARS)}…`
    : json;
}
