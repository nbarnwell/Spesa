import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

let db: Database.Database | undefined

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(config.dbPath)
    fs.mkdirSync(dir, { recursive: true })
    db = new Database(config.dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    migrate(db)
  }
  return db
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      sub TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT NOT NULL,
      user_sub TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, user_sub),
      FOREIGN KEY (user_sub) REFERENCES users(sub)
    );

    CREATE TABLE IF NOT EXISTS favourites (
      id TEXT NOT NULL,
      user_sub TEXT NOT NULL,
      product_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, user_sub),
      FOREIGN KEY (user_sub) REFERENCES users(sub)
    );

    CREATE TABLE IF NOT EXISTS shopping_list (
      id TEXT NOT NULL,
      user_sub TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity TEXT,
      checked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, user_sub),
      FOREIGN KEY (user_sub) REFERENCES users(sub)
    );

    CREATE TABLE IF NOT EXISTS stock (
      id TEXT NOT NULL,
      user_sub TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity TEXT,
      status TEXT NOT NULL CHECK (status IN ('in_stock', 'depleted')),
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, user_sub),
      FOREIGN KEY (user_sub) REFERENCES users(sub)
    );

    CREATE INDEX IF NOT EXISTS idx_products_user_updated ON products(user_sub, updated_at);
    CREATE INDEX IF NOT EXISTS idx_favourites_user_updated ON favourites(user_sub, updated_at);
    CREATE INDEX IF NOT EXISTS idx_shopping_user_updated ON shopping_list(user_sub, updated_at);
    CREATE INDEX IF NOT EXISTS idx_stock_user_updated ON stock(user_sub, updated_at);
  `)
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
}
