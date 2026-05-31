import { createHmac, timingSafeEqual } from 'crypto';

// Shared signing scheme for the server-to-server wallet API.
// Signature = HMAC-SHA256(secret, `${timestamp}${rawBody}`), hex-encoded.
// The platform signs with the same scheme; the white-label verifies here.

export function sign(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}${rawBody}`)
    .digest('hex');
}

export function verify(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = sign(secret, timestamp, rawBody);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
