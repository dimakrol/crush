import { AuthProvider, HttpError } from 'react-admin';
import { API_URL, httpClient } from './http';
import { SessionUser } from './types';

// The session is an httpOnly cookie, so this provider holds no token and there
// is nothing in localStorage to steal or to go stale. What it does hold is the
// identity behind that cookie, cached for the lifetime of the page: react-admin
// asks for permissions on every render that branches on a role, and each of
// those would otherwise be a round trip.
let cached: SessionUser | null = null;

async function loadIdentity(): Promise<SessionUser> {
  if (cached) return cached;
  const { json } = await httpClient(`${API_URL}/auth/me`);
  cached = json as SessionUser;
  return cached;
}

export const authProvider: AuthProvider = {
  async login(params: { username: string; password: string }) {
    const { json } = await httpClient(`${API_URL}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        username: params.username,
        password: params.password,
      }),
    });
    cached = json as SessionUser;
  },

  async logout() {
    cached = null;
    // The route is public precisely so this cannot fail on an expired session,
    // but a network error here must still end the session locally — otherwise
    // the operator is stuck on a screen they cannot leave.
    await httpClient(`${API_URL}/auth/logout`, { method: 'POST' }).catch(
      () => undefined,
    );
  },

  async checkAuth() {
    await loadIdentity();
  },

  // 401 means the session is gone: drop the cache and let react-admin bounce to
  // the login page. 403 is deliberately NOT that — the operator is signed in and
  // simply may not do this, and logging them out would hide the message saying
  // so behind a login form.
  async checkError(error: unknown) {
    const status = error instanceof HttpError ? error.status : undefined;
    if (status === 401) {
      cached = null;
      throw new Error('Session expired');
    }
  },

  async getIdentity() {
    const user = await loadIdentity();
    return { id: user.id, fullName: user.username };
  },

  // Returns the role. Null rather than a rejection when there is no session:
  // this is also called while the login page is on screen, and a rejection
  // there surfaces as an error notification over the form.
  async getPermissions() {
    try {
      return (await loadIdentity()).role;
    } catch {
      return null;
    }
  },
};
