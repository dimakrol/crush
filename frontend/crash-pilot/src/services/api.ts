// Thin fetch wrapper for the platform REST API.
// - Injects the Authorization header from the token store.
// - Unwraps the { data, meta } success envelope.
// - Throws a typed ApiError from the { error: { code, message } } envelope.
// - On 401, clears the token (drops the app to guest mode).

import { getToken, clearToken } from './token'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ApiResponse<T> {
  data: T
  meta?: Record<string, unknown>
}

interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | number | undefined>
  auth?: boolean // default true; set false for register/login
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = 'GET', body, query, auth = true } = options

  const url = new URL(path, BASE_URL)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server')
  }

  const payload = await res.json().catch(() => null)

  if (!res.ok) {
    if (res.status === 401) clearToken()
    const err = (payload as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? 'Request failed')
  }

  return (payload ?? { data: undefined }) as ApiResponse<T>
}
