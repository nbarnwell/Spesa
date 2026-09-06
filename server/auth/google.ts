import { createRemoteJWKSet, jwtVerify } from 'jose'
import { config } from '../config.js'
import type { UserProfile } from '../types.js'

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
)

const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000
const TOKEN_CACHE_MAX_SIZE = 500
const tokenCache = new Map<string, { profile: UserProfile; expiresAt: number }>()

function getCachedProfile(token: string): UserProfile | undefined {
  const entry = tokenCache.get(token)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    tokenCache.delete(token)
    return undefined
  }
  return entry.profile
}

function setCachedProfile(token: string, profile: UserProfile): void {
  if (!tokenCache.has(token) && tokenCache.size >= TOKEN_CACHE_MAX_SIZE) {
    const oldestKey = tokenCache.keys().next().value
    if (oldestKey !== undefined) tokenCache.delete(oldestKey)
  }
  tokenCache.set(token, { profile, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS })
}

function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3
}

async function verifyGoogleIdToken(token: string): Promise<UserProfile> {
  if (!config.googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID / VITE_OIDC_CLIENT_ID is not configured')
  }

  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.googleClientId,
  })

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Token missing sub claim')
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  }
}

async function fetchGoogleUserInfo(accessToken: string): Promise<UserProfile> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status}`)
  }

  const data = (await res.json()) as {
    sub?: string
    email?: string
    email_verified?: boolean
    name?: string
    picture?: string
  }

  if (!data.sub) throw new Error('Userinfo missing sub')

  return {
    sub: data.sub,
    email: data.email ?? '',
    emailVerified: data.email_verified === true,
    name: data.name,
    picture: data.picture,
  }
}

export async function authenticateBearerToken(token: string): Promise<UserProfile> {
  const cached = getCachedProfile(token)
  if (cached) return cached

  let profile: UserProfile
  if (looksLikeJwt(token)) {
    try {
      profile = await verifyGoogleIdToken(token)
    } catch {
      profile = await fetchGoogleUserInfo(token)
    }
  } else {
    profile = await fetchGoogleUserInfo(token)
  }

  setCachedProfile(token, profile)
  return profile
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}
