import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRequest, ApiError } from '../api'
import { setToken, getToken } from '../token'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

afterEach(() => {
  setToken(null)
  vi.restoreAllMocks()
})

describe('apiRequest', () => {
  it('unwraps the { data } envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { data: { balance: 42 } }))
    const res = await apiRequest<{ balance: number }>('/api/wallet')
    expect(res.data.balance).toBe(42)
  })

  it('returns meta alongside data', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { data: [], meta: { nextCursor: 'abc' } }))
    const res = await apiRequest('/api/bets/history')
    expect(res.meta?.nextCursor).toBe('abc')
  })

  it('appends defined query params and skips undefined', async () => {
    const fetchMock = mockFetch(200, { data: [] })
    vi.stubGlobal('fetch', fetchMock)
    await apiRequest('/api/bets/history', { query: { limit: 20, cursor: undefined } })
    const url = (fetchMock.mock.calls[0][0] as string)
    expect(url).toContain('limit=20')
    expect(url).not.toContain('cursor')
  })

  it('injects the Authorization header when a token is set', async () => {
    const fetchMock = mockFetch(200, { data: {} })
    vi.stubGlobal('fetch', fetchMock)
    setToken('tok123')
    await apiRequest('/api/auth/me')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123')
  })

  it('omits the Authorization header when auth:false', async () => {
    const fetchMock = mockFetch(200, { data: {} })
    vi.stubGlobal('fetch', fetchMock)
    setToken('tok123')
    await apiRequest('/api/auth/login', { method: 'POST', body: {}, auth: false })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('throws a typed ApiError from the { error } envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { error: { code: 'EMAIL_ALREADY_EXISTS', message: 'taken' } }))
    await expect(apiRequest('/api/auth/register', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_EXISTS',
      status: 409,
    })
  })

  it('clears the token on 401', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { error: { code: 'UNAUTHORIZED', message: 'nope' } }))
    setToken('expired')
    await expect(apiRequest('/api/wallet')).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBeNull()
  })

  it('wraps network failures as a NETWORK_ERROR ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    await expect(apiRequest('/api/wallet')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
  })
})
