import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPool, initDb, upsertUser } from './index.js'
import { setupTestDb, teardownTestDb } from '../test/db.js'

beforeEach(async () => {
  await setupTestDb()
})

afterEach(async () => {
  await teardownTestDb()
})

async function count(table: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table}`)
  return rows[0].n
}

describe('initDb', () => {
  it('creates the schema and records migration 1', async () => {
    const { rows: tables } = await getPool().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name <> 'schema_migrations'
       ORDER BY table_name`,
    )
    expect(tables.map((t) => t.table_name)).toEqual([
      'favourites',
      'household_invites',
      'household_members',
      'households',
      'products',
      'shopping_list',
      'stock',
      'users',
    ])

    const { rows } = await getPool().query<{ version: number }>(
      `SELECT version FROM schema_migrations`,
    )
    expect(rows.map((r) => r.version)).toEqual([1])
  })

  it('is a no-op when run again', async () => {
    await initDb()
    expect(await count('schema_migrations')).toBe(1)
  })

  it('tolerates concurrent runs on a fresh schema', async () => {
    await teardownTestDb()
    await setupTestDb({ migrate: false })
    await Promise.all([initDb(), initDb(), initDb()])
    expect(await count('schema_migrations')).toBe(1)
  })
})

describe('upsertUser', () => {
  it('creates exactly one household and membership under concurrent first requests', async () => {
    const user = { sub: 'new-user', email: 'new@example.com' }
    await Promise.all(Array.from({ length: 5 }, () => upsertUser(user)))

    expect(await count('users')).toBe(1)
    expect(await count('households')).toBe(1)
    expect(await count('household_members')).toBe(1)
  })

  it('updates profile fields on later calls without creating another household', async () => {
    await upsertUser({ sub: 'u', email: 'u@example.com' })
    await upsertUser({ sub: 'u', email: 'u2@example.com', name: 'U' })

    const { rows } = await getPool().query<{ email: string; name: string }>(
      `SELECT email, name FROM users WHERE sub = 'u'`,
    )
    expect(rows[0]).toEqual({ email: 'u2@example.com', name: 'U' })
    expect(await count('households')).toBe(1)
  })
})

