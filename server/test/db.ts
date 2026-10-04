import pg from 'pg'
import { config } from '../config.js'
import { closeDb, initDb } from '../db/index.js'

const DEFAULT_TEST_URL = 'postgres://spesa:spesa@localhost:5432/spesa_test'

let schema: string | undefined

function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL
}

async function withClient(fn: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() })
  await client.connect()
  try {
    await fn(client)
  } finally {
    await client.end()
  }
}

/** Points the app at a fresh, migrated schema so tests (and parallel test files) are isolated. */
export async function setupTestDb(options: { migrate?: boolean } = {}): Promise<void> {
  await closeDb()
  config.databaseUrl = testDatabaseUrl()

  schema = `t_${crypto.randomUUID().replace(/-/g, '')}`
  const name = schema
  await withClient(async (client) => {
    await client.query(`CREATE SCHEMA "${name}"`)
  })

  config.dbSchema = schema
  if (options.migrate !== false) await initDb()
}

export async function teardownTestDb(): Promise<void> {
  // Close the pool first: open connections can hold locks that block DROP SCHEMA.
  await closeDb()
  const name = schema
  schema = undefined
  config.dbSchema = undefined
  if (!name) return
  await withClient(async (client) => {
    await client.query(`DROP SCHEMA "${name}" CASCADE`)
  })
}
