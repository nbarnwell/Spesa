import express, { Router, type ErrorRequestHandler, type RequestHandler } from 'express'
import { config } from '../config.js'
import { exchangeGoogleToken } from '../auth/google.js'

const RATE_WINDOW_MS = 60_000
const RATE_MAX_KEYS = 10_000

interface Bucket {
  count: number
  resetAt: number
}

function createRateLimiter(): RequestHandler {
  const buckets = new Map<string, Bucket>()

  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip ?? 'unknown'

    if (buckets.size > RATE_MAX_KEYS) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k)
      }
    }

    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS }
      buckets.set(key, bucket)
    }
    bucket.count += 1

    if (bucket.count > config.authRateLimitPerMinute) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))))
      res.set('Cache-Control', 'no-store')
      res.status(429).json({ error: 'rate_limited' })
      return
    }
    next()
  }
}

/**
 * Unauthenticated OAuth token proxy. Adds the Google client secret server-side so it
 * never reaches the browser, and only forwards an allow-list of fields for the two
 * grant types the SPA uses.
 */
export function createAuthRouter(): Router {
  const router = Router()

  router.use(createRateLimiter())
  router.use(express.urlencoded({ extended: false, limit: '10kb' }))

  router.post('/token', async (req, res) => {
    res.set('Cache-Control', 'no-store')

    // The global JSON parser runs first, so a JSON body would otherwise be accepted here.
    const body = (req.is('application/x-www-form-urlencoded') ? (req.body ?? {}) : {}) as Record<
      string,
      unknown
    >
    const field = (name: string): string | undefined => {
      const value = body[name]
      return typeof value === 'string' && value !== '' ? value : undefined
    }
    const fail = (status: number, error: string, description?: string): void => {
      res.status(status).json(description ? { error, error_description: description } : { error })
    }

    if (!config.googleClientId || !config.googleClientSecret) {
      fail(500, 'server_error', 'OAuth client is not configured on the server')
      return
    }

    if (body.client_id !== undefined && body.client_id !== config.googleClientId) {
      fail(400, 'invalid_client')
      return
    }

    const params = new URLSearchParams()
    const grantType = field('grant_type')

    if (grantType === 'authorization_code') {
      const code = field('code')
      const codeVerifier = field('code_verifier')
      const redirectUri = field('redirect_uri')
      if (!code || !codeVerifier || !redirectUri) {
        fail(400, 'invalid_request')
        return
      }
      if (config.oidcRedirectUri && config.oidcRedirectUri !== redirectUri) {
        fail(400, 'invalid_request', 'redirect_uri mismatch')
        return
      }
      params.set('grant_type', grantType)
      params.set('code', code)
      params.set('code_verifier', codeVerifier)
      params.set('redirect_uri', redirectUri)
    } else if (grantType === 'refresh_token') {
      const refreshToken = field('refresh_token')
      if (!refreshToken) {
        fail(400, 'invalid_request')
        return
      }
      params.set('grant_type', grantType)
      params.set('refresh_token', refreshToken)
    } else {
      fail(400, 'unsupported_grant_type')
      return
    }

    params.set('client_id', config.googleClientId)
    params.set('client_secret', config.googleClientSecret)

    let result
    try {
      result = await exchangeGoogleToken(params)
    } catch (err) {
      console.error('Google token exchange failed:', err instanceof Error ? err.message : 'unknown error')
      fail(502, 'temporarily_unavailable')
      return
    }

    if (JSON.stringify(result.body).includes(config.googleClientSecret)) {
      fail(502, 'server_error')
      return
    }

    res.status(result.status).json(result.body)
  })

  // Express identifies error middleware by its 4-argument arity.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const raw = (err as { status?: number; statusCode?: number })
    const status = raw.status ?? raw.statusCode
    res.set('Cache-Control', 'no-store')
    res.status(status && status >= 400 && status < 500 ? status : 400).json({ error: 'invalid_request' })
  }
  router.use(onError)

  return router
}
