import { createHmac } from 'crypto';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';

// Server-to-server client for the white-label (operator) API. Signs every
// request exactly the way the white-label verifies it:
//   X-Signature = HMAC-SHA256(OPERATOR_SECRET, `${timestamp}${rawBody}`), hex.
// The signed body MUST be the exact bytes we send, so we serialize once and
// reuse that string for both the signature and the request body.

const KNOWN_CODES = new Set<string>(Object.values(ErrorCode));

interface OperatorErrorBody {
  error?: { code?: string; message?: string };
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function operatorPost<T>(path: string, body: unknown): Promise<T> {
  const rawBody = JSON.stringify(body ?? {});
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', env.OPERATOR_SECRET)
    .update(`${timestamp}${rawBody}`)
    .digest('hex');

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${env.WALLET_API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': env.OPERATOR_API_KEY,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
      },
      body: rawBody,
    });
  } catch (err) {
    throw new AppError(
      503,
      ErrorCode.WALLET_UNAVAILABLE,
      `Wallet service unreachable: ${(err as Error).message}`,
    );
  }

  const text = await res.text();
  const json = text ? parseBody(text) : {};

  if (!res.ok) {
    const errBody = (json ?? {}) as OperatorErrorBody;
    const code = errBody.error?.code ?? '';
    const message =
      errBody.error?.message ?? `Wallet service error (HTTP ${res.status})`;
    // Reuse the operator's error code when the platform shares the same name
    // (e.g. INSUFFICIENT_BALANCE, launch-token codes); otherwise treat it as an
    // upstream wallet failure.
    const mapped = KNOWN_CODES.has(code)
      ? (code as ErrorCode)
      : ErrorCode.WALLET_UNAVAILABLE;
    throw new AppError(res.status, mapped, message);
  }

  return json as T;
}
