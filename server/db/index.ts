import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

let db: Database.Database | undefined

export function getDb(): Database.Database {
  if (!db) {
    db = openDb(config.dbPath)
  }
  return db
}

/** Test-only: closes the singleton so the next getDb() reopens (e.g. against a new config.dbPath). */
export function closeDbForTests(): void {
  db?.close()
  db = undefined
}

function openDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath)
  fs.mkdirSync(dir, { recursive: true })
  const database = new Database(dbPath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  migrate(database)
  return database
}

const CURRENT_SCHEMA_VERSION = 1

function migrate(database: Database.Database): void {
  const version = database.pragma('user_version', { simple: true }) as number

  if (version >= CURRENT_SCHEMA_VERSION) {
    createSchemaIfMissing(database)
    return
  }

  const hasLegacyProducts = tableHasColumn(database, 'products', 'user_sub')

  if (!hasLegacyProducts) {
    createSchemaIfMissing(database)
    database.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
    return
  }

  migrateToHouseholds(database)
}

function tableHasColumn(database: Database.Database, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((r) => r.name === column)
}

function createSchemaIfMissing(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      sub TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(sub),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS household_members (
      household_id TEXT NOT NULL REFERENCES households(id),
      user_sub TEXT NOT NULL REFERENCES users(sub),
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (household_id, user_sub)
    );

    CREATE TABLE IF NOT EXISTS household_invites (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id),
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL REFERENCES users(sub),
      status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','revoked')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_pending
      ON household_invites(household_id, email) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_invites_email ON household_invites(email, status);

    CREATE TABLE IF NOT EXISTS products (
      id TEXT NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id),
      name TEXT NOT NULL,
      category TEXT,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, household_id)
    );

    CREATE TABLE IF NOT EXISTS favourites (
      id TEXT NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id),
      product_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, household_id)
    );

    CREATE TABLE IF NOT EXISTS shopping_list (
      id TEXT NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id),
      product_id TEXT NOT NULL,
      quantity TEXT,
      checked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, household_id)
    );

    CREATE TABLE IF NOT EXISTS stock (
      id TEXT NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id),
      product_id TEXT NOT NULL,
      quantity TEXT,
      status TEXT NOT NULL CHECK (status IN ('in_stock', 'depleted')),
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, household_id)
    );

    CREATE INDEX IF NOT EXISTS idx_products_household_updated ON products(household_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_favourites_household_updated ON favourites(household_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_shopping_household_updated ON shopping_list(household_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_stock_household_updated ON stock(household_id, updated_at);
  `)
}

interface LegacyTableSpec {
  table: 'products' | 'favourites' | 'shopping_list' | 'stock'
  /** Columns (old shape, minus id/user_sub) in insert order, shared by old and new shape. */
  columns: string[]
}

const LEGACY_TABLES: LegacyTableSpec[] = [
  { table: 'products', columns: ['name', 'category', 'updated_at', 'deleted_at'] },
  { table: 'favourites', columns: ['product_id', 'sort_order', 'updated_at', 'deleted_at'] },
  { table: 'shopping_list', columns: ['product_id', 'quantity', 'checked', 'updated_at', 'deleted_at'] },
  { table: 'stock', columns: ['product_id', 'quantity', 'status', 'updated_at', 'deleted_at'] },
]

function migrateToHouseholds(database: Database.Database): void {
  // PRAGMA foreign_keys cannot be toggled inside a transaction, and the
  // drop/rename below would otherwise trip the FK from the legacy tables to users(sub).
  database.pragma('foreign_keys = OFF')

  const run = database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS households (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(sub),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS household_members (
        household_id TEXT NOT NULL REFERENCES households(id),
        user_sub TEXT NOT NULL REFERENCES users(sub),
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
        joined_at TEXT NOT NULL,
        PRIMARY KEY (household_id, user_sub)
      );

      CREATE TABLE IF NOT EXISTS household_invites (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL REFERENCES households(id),
        email TEXT NOT NULL,
        invited_by TEXT NOT NULL REFERENCES users(sub),
        status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','revoked')),
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_pending
        ON household_invites(household_id, email) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_invites_email ON household_invites(email, status);
    `)

    const users = database
      .prepare(`SELECT sub, email, name FROM users`)
      .all() as Array<{ sub: string; email: string; name: string | null }>

    for (const user of users) {
      createPersonalHousehold(database, user.sub, user.name ?? undefined, user.email)
    }

    for (const spec of LEGACY_TABLES) {
      rebuildTableForHouseholds(database, spec)
    }

    database.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
  })

  run()
  database.pragma('foreign_keys = ON')
}

function rebuildTableForHouseholds(database: Database.Database, spec: LegacyTableSpec): void {
  const { table, columns } = spec
  const tmpTable = `${table}_new`
  const colList = columns.join(', ')

  database.exec(`DROP TABLE IF EXISTS ${tmpTable}`)

  database.exec(`
    CREATE TABLE ${tmpTable} (
      id TEXT NOT NULL,
      household_id TEXT NOT NULL REFERENCES households(id),
      ${columnDefinitions(table)}
      PRIMARY KEY (id, household_id)
    )
  `)

  database.exec(`
    INSERT INTO ${tmpTable} (id, household_id, ${colList})
    SELECT t.id, hm.household_id, ${columns.map((c) => `t.${c}`).join(', ')}
    FROM ${table} t
    JOIN household_members hm ON hm.user_sub = t.user_sub
  `)

  database.exec(`DROP TABLE ${table}`)
  database.exec(`ALTER TABLE ${tmpTable} RENAME TO ${table}`)
  database.exec(
    `CREATE INDEX idx_${table}_household_updated ON ${table}(household_id, updated_at)`,
  )
}

function columnDefinitions(table: LegacyTableSpec['table']): string {
  switch (table) {
    case 'products':
      return 'name TEXT NOT NULL, category TEXT, updated_at TEXT NOT NULL, deleted_at TEXT,'
    case 'favourites':
      return 'product_id TEXT NOT NULL, sort_order INTEGER NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,'
    case 'shopping_list':
      return 'product_id TEXT NOT NULL, quantity TEXT, checked INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, deleted_at TEXT,'
    case 'stock':
      return "product_id TEXT NOT NULL, quantity TEXT, status TEXT NOT NULL CHECK (status IN ('in_stock', 'depleted')), updated_at TEXT NOT NULL, deleted_at TEXT,"
  }
}

function createPersonalHousehold(
  database: Database.Database,
  sub: string,
  name: string | undefined,
  email: string,
): string {
  const householdId = crypto.randomUUID()
  const ts = nowIso()
  const householdName = name?.trim() || email.split('@')[0] || 'My household'

  database
    .prepare(`INSERT INTO households (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`)
    .run(householdId, householdName, sub, ts)

  database
    .prepare(
      `INSERT INTO household_members (household_id, user_sub, role, joined_at)
       VALUES (?, ?, 'owner', ?)`,
    )
    .run(householdId, sub, ts)

  return householdId
}

/** Creates a personal household for a user with no membership yet. No-op otherwise. */
export function ensureUserHousehold(sub: string, name: string | undefined, email: string): void {
  const database = getDb()
  const existing = database
    .prepare(`SELECT 1 FROM household_members WHERE user_sub = ? LIMIT 1`)
    .get(sub)
  if (existing) return

  createPersonalHousehold(database, sub, name, email)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function upsertUser(user: {
  sub: string
  email: string
  name?: string
  picture?: string
}): void {
  const database = getDb()
  database
    .prepare(
      `INSERT INTO users (sub, email, name, picture, created_at)
       VALUES (@sub, @email, @name, @picture, @createdAt)
       ON CONFLICT(sub) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         picture = excluded.picture`,
    )
    .run({
      sub: user.sub,
      email: user.email,
      name: user.name ?? null,
      picture: user.picture ?? null,
      createdAt: nowIso(),
    })

  ensureUserHousehold(user.sub, user.name, user.email)
}
