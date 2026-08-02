import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import { logger } from '../../shared/utils/logger';

// The ONLY place that knows PLATFORM_API_URL and ADMIN_API_KEY.
//
// Every change the backoffice makes to the game goes through the platform's
// admin API, never through SQL — the platform owns the round loop, the bets and
// the money outbox, and a write that goes around it would be a state change no
// outbox row remembers. The read side of this service uses a Postgres role that
// physically cannot write, which is the other half of the same rule.
//
// The key is a server-side secret. Nothing in this file is ever reachable from
// the browser except through a route the operator's session and role have
// already been checked on.

const TIMEOUT_MS = 5000;

interface PlatformErrorBody {
  error?: { code?: string; message?: string };
}

@Injectable()
export class PlatformAdminClient {
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${env.PLATFORM_API_URL}${path}`;

    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-admin-key': env.ADMIN_API_KEY,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Could not reach the platform at all. Distinct from a refusal it sent
      // back, and distinct in the audit log too: nothing happened on the other
      // side, so this is safe to retry.
      logger.error('Platform admin API unreachable', {
        method,
        path,
        error: (err as Error).message,
      });
      throw new AppError(
        502,
        ErrorCode.PLATFORM_UNAVAILABLE,
        `Platform did not respond (${method} ${path})`,
      );
    }

    const text = await res.text();
    const parsed = text
      ? (safeJson(text) as PlatformErrorBody & { data?: T })
      : null;

    if (!res.ok) {
      // Passed through with the platform's own status and message: an operator
      // who force-crashes between rounds must read "no running round to crash",
      // not a 500 that makes them think the console is broken. The code is the
      // platform's vocabulary, not ours — the one place a foreign code enters
      // this project.
      throw new AppError(
        res.status,
        (parsed?.error?.code as ErrorCode) ?? ErrorCode.INTERNAL_SERVER_ERROR,
        parsed?.error?.message ?? `Platform returned ${res.status}`,
      );
    }

    return parsed?.data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
