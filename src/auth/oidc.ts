import { UserManager, WebStorageStateStore } from 'oidc-client-ts'

const clientId = import.meta.env.VITE_OIDC_CLIENT_ID ?? ''
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
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  metadata: {
    issuer: 'https://accounts.google.com',
    authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token',
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
