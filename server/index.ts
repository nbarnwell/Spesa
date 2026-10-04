import { createApp, attachFrontend } from './app.js'
import { config } from './config.js'
import { closeDb, initDb } from './db/index.js'

async function main(): Promise<void> {
  if (config.isProduction && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in production')
  }

  await initDb()

  const app = createApp()
  await attachFrontend(app)

  const server = app.listen(config.port, () => {
    const mode = config.isProduction ? 'production' : 'development'
    console.log(`Spesa server (${mode}) http://localhost:${config.port}`)
  })

  const shutdown = (): void => {
    server.close(() => {
      closeDb()
        .catch((err) => console.error(err))
        .finally(() => process.exit(0))
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
