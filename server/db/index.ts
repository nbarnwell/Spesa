import pg from 'pg'
import { config } from '../config.js'
import { MIGRATIONS } from './migrations.js'

const { Pool, types } = pg

// timestamptz -> ISO-8601 string, so DTOs keep the exact shape clients already see.
const TIMESTAMPTZ_OID = 1184
const parseTimestamptz = types.getTypeParser(TIMESTAMPTZ_OID)
types.setTypeParser(TIMESTAMPTZ_OID, (v) => (parseTimestamptz(v) as Date).toISOString())

const MIGRATION_LOCK_KEY = 5005005

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<R>>
}

let pool: pg.Pool | undefined

function buildPool(): pg.Pool {
  let connectionString = config.databaseUrl
  const options: pg.PoolConfig = { max: config.dbPoolMax }

  if (config.databaseCaCert) {
    // pg lets sslmode in the URL override the ssl option, and sslmode=require verifies
    // against system CAs, which fails for a private CA. Strip it and pass the CA explicitly.
    const url = new URL(connectionString)
    url.searchParams.delete('sslmode')
    connectionString = url.toString()
    options.ssl = { ca: config.databaseCaCert, rejectUnauthorized: true }
  }

  if (config.dbSchema) {
    options.options = `-c search_path=${config.dbSchema}`
  }

  const created = new Pool({ ...options, connectionString })
  created.on('error', (err) => {
    console.error('Unexpected Postgres pool error', err)
  })
  return created
}

export function getPool(): pg.Pool {
  pool ??= buildPool()
  return pool
}

export async function closeDb(): Promise<void> {
  const current = pool
  pool = undefined
  await current?.end()
}

export async function withTransaction<T>(
  fn: (tx: pg.PoolClient) => Promise<T>,
  options: { isolation?: 'repeatable read'; readOnly?: boolean } = {},
): Promise<T> {
  const client = await getPool().connect()
  try {
    const modes: string[] = []
    if (options.isolation) modes.push(`ISOLATION LEVEL ${options.isolation.toUpperCase()}`)
    if (options.readOnly) modes.push('READ ONLY')
    await client.query(modes.length ? `BEGIN ${modes.join(' ')}` : 'BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // connection is already broken; the original error is the useful one
    }
    throw err
  } finally {
    client.release()
  }
}

/** Applies pending migrations. Safe to call from several instances at once. */
export async function initDb(): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY])
    await tx.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    const { rows } = await tx.query<{ v: number }>(
      'SELECT COALESCE(MAX(version), 0)::int AS v FROM schema_migrations',
    )
    const current = rows[0].v

    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue
      await tx.query(migration.sql)
      await tx.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ])
    }
  })
}

export function nowIso(): string {
  return new Date().toISOString()
}

async function createPersonalHousehold(
  db: Queryable,
  sub: string,
  name: string | undefined,
  email: string,
): Promise<string> {
  const householdId = crypto.randomUUID()
  const ts = nowIso()
  const householdName = name?.trim() || email.split('@')[0] || 'My household'

  await db.query(
    `INSERT INTO households (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)`,
    [householdId, householdName, sub, ts],
  )
  await db.query(
    `INSERT INTO household_members (household_id, user_sub, role, joined_at)
     VALUES ($1, $2, 'owner', $3)`,
    [householdId, sub, ts],
  )

  return householdId
}

/** Creates a personal household for a user with no membership yet. No-op otherwise. */
export async function ensureUserHousehold(
  sub: string,
  name: string | undefined,
  email: string,
  db: Queryable = getPool(),
): Promise<void> {
  const existing = await db.query(`SELECT 1 FROM household_members WHERE user_sub = $1 LIMIT 1`, [
    sub,
  ])
  if (existing.rowCount) return

  await createPersonalHousehold(db, sub, name, email)
}

export async function upsertUser(user: {
  sub: string
  email: string
  name?: string
  picture?: string
}): Promise<void> {
  // The user upsert comes first: it row-locks the user until commit, so concurrent
  // first-time requests queue here and the later ones see the committed membership.
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO users (sub, email, name, picture, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sub) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         picture = EXCLUDED.picture`,
      [user.sub, user.email, user.name ?? null, user.picture ?? null, nowIso()],
    )
    await ensureUserHousehold(user.sub, user.name, user.email, tx)
  })
}
