# 3. Server-side OAuth token exchange

## Status

Accepted.

## Context

Google **Web application** OAuth clients require `client_secret` at the token endpoint even when PKCE is used, so exchanging the authorization code directly from the browser fails with `400 client_secret is missing`. The secret cannot ship in the client bundle. Issue #7.

## Decision

- **Thin token proxy.** `POST /auth/token` forwards to Google's token endpoint, adding `client_id` and `client_secret` from server config, and returns Google's status and JSON. Tokens still live in the browser (`oidc-client-ts`, localStorage). Bearer validation on `/api` is unchanged.
- **Allow-listed forwarding.** The server rebuilds the outbound form for only the `authorization_code` and `refresh_token` grants, so a caller cannot use the secret with arbitrary grant types or parameters. A mismatching `client_id` is rejected rather than overwritten.
- **Refresh tokens are requested** (`access_type=offline`, `prompt=consent`). Google only returns a refresh token on consent, and sign-out discards the stored user, so without `prompt=consent` every later sign-in would yield a session that dies after an hour. Iframe silent renew was rejected because browsers block the third-party cookies it needs.
- **Renewal never signs out on transient errors.** The client clears the session only when there is no refresh token or Google answers `invalid_grant`; offline, 5xx and 429 keep the session and retry. An already-expired token is renewed on load, on the sync poll, and when connectivity returns, since the library's own timer does not fire for expired tokens.

## Consequences

- `GOOGLE_CLIENT_SECRET` is a runtime-only server variable; production refuses to start without it.
- Refresh tokens sit in browser localStorage, so an XSS could steal one, though it is only redeemable through this endpoint.
- The Google consent screen appears on every sign-in; sign-ins are rare because sessions renew.
- The endpoint is unauthenticated and spends the Google client's quota, so it is rate limited per IP, per instance, in memory.
- A full server-held session (httpOnly cookie, tokens never in the browser) would be stronger against XSS, but is a redesign of auth and the offline client; it remains a possible future step.
