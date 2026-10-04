import 'dotenv/config'

const port = Number(process.env.PORT ?? 5174)

export const config = {
  port,
  isProduction: process.env.NODE_ENV === 'production',
  googleClientId: process.env.VITE_OIDC_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://spesa:spesa@localhost:5432/spesa',
  databaseCaCert: process.env.DATABASE_CA_CERT || undefined,
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  dbSchema: undefined as string | undefined, // tests only; never read from env
}
