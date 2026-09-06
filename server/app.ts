import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { apiRouter } from './routes/api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const distPath = path.join(projectRoot, 'dist')

export function createApp(): express.Express {
  const app = express()

  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.use('/api', apiRouter)

  return app
}

export async function attachFrontend(app: express.Express): Promise<void> {
  if (config.isProduction) {
    app.use(express.static(distPath, { index: false }))
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
    return
  }

  const { createServer } = await import('vite')
  const vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true },
    appType: 'spa',
  })

  app.use(vite.middlewares)
}

export { projectRoot, distPath }
