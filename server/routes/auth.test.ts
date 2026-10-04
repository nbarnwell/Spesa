import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../auth/google.js', async () => {
  const actual = await vi.importActual<typeof import('../auth/google.js')>('../auth/google.js')
  return { ...actual, exchangeGoogleToken: vi.fn() }
})

const { exchangeGoogleToken } = await import('../auth/google.js')
const { createApp } = await import('../app.js')
const { config } = await import('../config.js')

const SECRET = 'test-secret-value'
const original = { ...config }

const tokenResponse = {
  access_token: 'a',
  id_token: 'i',
  refresh_token: 'r',
  expires_in: 3599,
  token_type: 'Bearer',
}

let server: http.Server
let baseUrl: string

function post(
  fields: Record<string, string> | string,
  headers?: Record<string, string>,
): Promise<Response> {
  const isString = typeof fields === 'string'
  return fetch(`${baseUrl}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: isString ? fields : new URLSearchParams(fields),
  })
}

function sentParams(): URLSearchParams {
  return vi.mocked(exchangeGoogleToken).mock.calls[0][0]
}

const codeForm = {
  grant_type: 'authorization_code',
  code: 'the-code',
  code_verifier: 'the-verifier',
  redirect_uri: 'http://localhost:5174/auth/callback',
  client_id: 'test-client-id',
}

beforeEach(async () => {
  config.googleClientId = 'test-client-id'
  config.googleClientSecret = SECRET
  config.oidcRedirectUri = undefined
  config.authRateLimitPerMinute = 30

  vi.mocked(exchangeGoogleToken).mockReset()
  vi.mocked(exchangeGoogleToken).mockResolvedValue({ status: 200, body: tokenResponse })

  const app = createApp()
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  Object.assign(config, original)
  await new Promise((resolve) => server.close(resolve))
  vi.restoreAllMocks()
})

describe('POST /auth/token', () => {
  it('exchanges an authorization code with server-side credentials', async () => {
    const res = await post(codeForm)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual(tokenResponse)

    expect(Object.fromEntries(sentParams())).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: codeForm.redirect_uri,
      client_id: 'test-client-id',
      client_secret: SECRET,
    })
  })

  it('refreshes a token without forwarding scope', async () => {
    const res = await post({
      grant_type: 'refresh_token',
      refresh_token: 'rt',
      scope: 'openid profile email',
      client_id: 'test-client-id',
    })
    expect(res.status).toBe(200)
    expect(Object.fromEntries(sentParams())).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt',
      client_id: 'test-client-id',
      client_secret: SECRET,
    })
  })

  it('needs no bearer token', async () => {
    const res = await post(codeForm)
    expect(res.status).toBe(200)
  })

  it('passes Google errors through unchanged', async () => {
    const body = { error: 'invalid_grant', error_description: 'Bad Request' }
    vi.mocked(exchangeGoogleToken).mockResolvedValue({ status: 400, body })
    const res = await post({ grant_type: 'refresh_token', refresh_token: 'bad' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual(body)
  })

  it('never includes the secret in any response', async () => {
    const responses = [
      await post(codeForm),
      await post({ grant_type: 'password' }),
      await post({ ...codeForm, client_id: 'other' }),
    ]
    for (const res of responses) {
      expect(await res.text()).not.toContain(SECRET)
    }
  })

  it('refuses to return a body that echoes the secret', async () => {
    vi.mocked(exchangeGoogleToken).mockResolvedValue({ status: 200, body: { echoed: SECRET } })
    const res = await post(codeForm)
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain(SECRET)
  })

  it.each([
    ['password', { grant_type: 'password' }],
    ['client_credentials', { grant_type: 'client_credentials' }],
    ['missing grant_type', {}],
  ])('rejects unsupported grant: %s', async (_name, fields) => {
    const res = await post(fields)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_grant_type')
    expect(exchangeGoogleToken).not.toHaveBeenCalled()
  })

  it('rejects a code exchange without code_verifier', async () => {
    const rest: Record<string, string> = { ...codeForm }
    delete rest.code_verifier
    const res = await post(rest)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_request')
    expect(exchangeGoogleToken).not.toHaveBeenCalled()
  })

  it('rejects a refresh without refresh_token', async () => {
    const res = await post({ grant_type: 'refresh_token' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_request')
    expect(exchangeGoogleToken).not.toHaveBeenCalled()
  })

  it('rejects JSON and empty bodies', async () => {
    const json = await fetch(`${baseUrl}/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(codeForm),
    })
    expect(json.status).toBe(400)

    const empty = await fetch(`${baseUrl}/auth/token`, { method: 'POST' })
    expect(empty.status).toBe(400)
    expect(exchangeGoogleToken).not.toHaveBeenCalled()
  })

  it('treats repeated keys as missing', async () => {
    const res = await post('grant_type=authorization_code&grant_type=refresh_token')
    expect(res.status).toBe(400)
    expect(exchangeGoogleToken).not.toHaveBeenCalled()
  })

  it('rejects a mismatched client_id', async () => {
    const res = await post({ ...codeForm, client_id: 'someone-else' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client')
    expect(exchangeGoogleToken).not.toHaveBeenCalled()
  })

  it('enforces redirect_uri only when configured', async () => {
    config.oidcRedirectUri = 'http://localhost:5174/auth/callback'

    const bad = await post({ ...codeForm, redirect_uri: 'http://evil.example/cb' })
    expect(bad.status).toBe(400)
    expect(exchangeGoogleToken).not.toHaveBeenCalled()

    const good = await post(codeForm)
    expect(good.status).toBe(200)
  })

  it('returns 500 when the secret is not configured', async () => {
    config.googleClientSecret = ''
    const res = await post(codeForm)
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: string }).error).toBe('server_error')
    expect(exchangeGoogleToken).not.toHaveBeenCalled()
  })

  it('returns 502 and logs only the message when Google is unreachable', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(exchangeGoogleToken).mockRejectedValue(new Error('boom'))
    const res = await post(codeForm)
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toBe('temporarily_unavailable')
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET)
  })

  it('rate limits per client', async () => {
    config.authRateLimitPerMinute = 2
    expect((await post(codeForm)).status).toBe(200)
    expect((await post(codeForm)).status).toBe(200)
    const limited = await post(codeForm)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect(exchangeGoogleToken).toHaveBeenCalledTimes(2)
  })
})
