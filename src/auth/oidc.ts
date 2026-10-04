import { ErrorResponse, UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'
import { BFF_ROUTES } from '../api/contract'

const clientId = import.meta.env.VITE_OIDC_CLIENT_ID ?? ''
const bffBaseUrl =
  import.meta.env.VITE_BFF_BASE_URL?.replace(/\/$/, '') || window.location.origin
const redirectUri =
  import.meta.env.VITE_OIDC_REDIRECT_URI ?? `${window.location.origin}/auth/callback`

export const isOidcConfigured = (): boolean => Boolean(clientId)

export const userManager = new UserManager({
  authority: 'https://accounts.google.com',
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'openid profile email',
  automaticSilentRenew: true,
  // Google only issues a refresh token on consent, and sign-out discards the stored one.
  prompt: 'consent',
  extraQueryParams: { access_type: 'offline' },
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  metadata: {
    issuer: 'https://accounts.google.com',
    authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    // Proxied by the BFF, which adds the client secret Google requires for Web clients.
    token_endpoint: `${bffBaseUrl}${BFF_ROUTES.authToken}`,
    userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  },
})

export async function signIn(): Promise<void> {
  await userManager.signinRedirect()
}

export async function completeSignIn(): Promise<void> {
  await userManager.signinRedirectCallback()
}

export async function signOut(): Promise<void> {
  await userManager.removeUser()
}

let renewing: Promise<User | null> | null = null

/**
 * Renews an expired session with the stored refresh token. Resolves to the renewed user,
 * or null when the session can't be renewed and has been cleared (no refresh token, or
 * Google rejected it). Rejects on transient failures (offline, 5xx) — the session is kept.
 */
export function renewSession(): Promise<User | null> {
  if (renewing) return renewing

  renewing = (async () => {
    const user = await userManager.getUser()
    if (!user) return null
    if (!user.refresh_token) {
      await userManager.removeUser()
      return null
    }
    try {
      return await userManager.signinSilent()
    } catch (err) {
      if (err instanceof ErrorResponse && err.error === 'invalid_grant') {
        await userManager.removeUser()
        return null
      }
      throw err
    }
  })().finally(() => {
    renewing = null
  })

  return renewing
}
