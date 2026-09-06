import 'dotenv/config'

const port = Number(process.env.PORT ?? 5173)

export const config = {
  port,
  isProduction: process.env.NODE_ENV === 'production',
  googleClientId: process.env.VITE_OIDC_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '',
  dbPath: process.env.DB_PATH ?? 'data/spesa.db',
}
