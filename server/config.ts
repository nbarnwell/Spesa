import 'dotenv/config'

const port = Number(process.env.PORT ?? 5174)

export const config = {
  port,
  isProduction: process.env.NODE_ENV === 'production',
  googleClientId: process.env.VITE_OIDC_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  oidcRedirectUri: process.env.VITE_OIDC_REDIRECT_URI || undefined,
  authRateLimitPerMinute: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 30),
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : undefined,
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://spesa:spesa@localhost:5432/spesa',
  databaseCaCert: process.env.DATABASE_CA_CERT || undefined,
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  dbSchema: undefined as string | undefined, // tests only; never read from env
}

/** Throws when a variable that is mandatory in production is missing. */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL must be set in production')
  if (!env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET must be set in production')
}
