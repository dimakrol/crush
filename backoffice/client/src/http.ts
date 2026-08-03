import { fetchUtils, HttpError } from 'react-admin';

export const API_URL = '/api';

type FetchOptions = Parameters<typeof fetchUtils.fetchJson>[1];

// The one place the client talks to the server.
//
// Two things every request needs and neither the data provider nor the auth
// provider should have to remember: send the session cookie, and turn the
// server's envelopes into what react-admin expects on both the success and the
// failure path.
export async function httpClient(url: string, options: FetchOptions = {}) {
  try {
    const response = await fetchUtils.fetchJson(url, {
      ...options,
      credentials: 'include',
    });
    return { ...response, json: unwrap(response.json) };
  } catch (error) {
    throw withServerMessage(error);
  }
}

// Every route answers `{ data: … }`, uniformly, including the lists.
// ra-data-simple-rest wants the record or the array itself, so the envelope is
// opened here rather than in nine places.
function unwrap(json: unknown): unknown {
  if (json && typeof json === 'object' && 'data' in json) {
    return (json as { data: unknown }).data;
  }
  return json;
}

// Errors are `{ error: { code, message } }`. fetchJson does not know that and
// falls back to the status text, which would show an operator "Conflict" where
// the server said "This is the last admin; promote another account first" —
// the difference between a screen you can act on and one you cannot.
function withServerMessage(error: unknown): unknown {
  if (!(error instanceof HttpError)) return error;
  const body = error.body as { error?: { message?: string } } | undefined;
  const message = body?.error?.message;
  return message ? new HttpError(message, error.status, error.body) : error;
}
