import { CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { Role } from '../../drizzle/admin.schema';

// The operator session. A JWT rather than a server-side session table because
// the backoffice is a single process with no shared store worth the trouble —
// but it is carried in an httpOnly cookie, not in JavaScript's hands: an XSS in
// a console that can pause the game must not be able to walk off with the
// session.

export const SESSION_COOKIE = 'bo_session';

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
}

export function signSession(user: SessionUser): string {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    env.BACKOFFICE_JWT_SECRET,
    {
      expiresIn: env.BACKOFFICE_JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    },
  );
}

// Returns null for anything that is not a currently valid session, so callers
// never have to tell "expired" from "forged" — both mean "log in again".
export function verifySession(token: string): SessionUser | null {
  try {
    const payload = jwt.verify(token, env.BACKOFFICE_JWT_SECRET) as {
      sub: string;
      username: string;
      role: Role;
    };
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

// No maxAge on purpose: the cookie dies with the browser session while the JWT
// carries the real 8h limit. Closing the tab therefore ends the shift, which is
// the behaviour you want on a shared operator machine.
//
// SameSite=Lax, not None: the console is same-origin (Nest serves the SPA and
// the API together), so nothing legitimate ever sends this cookie cross-site.
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
  };
}
