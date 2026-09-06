import { createApp, attachFrontend } from './app.js'
import { config } from './config.js'
import { getDb } from './db/index.js'

async function main(): Promise<void> {
  getDb()

  const app = createApp()
  await attachFrontend(app)

  app.listen(config.port, () => {
    const mode = config.isProduction ? 'production' : 'development'
    console.log(`Spesa server (${mode}) http://localhost:${config.port}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
