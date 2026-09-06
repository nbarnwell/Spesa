import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { closeDbForTests, getDb } from './index.js'

function seedLegacyDatabase(dbPath: string): void {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE users (
      sub TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE products (
      id TEXT NOT NULL,
      user_sub TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, user_sub),
      FOREIGN KEY (user_sub) REFERENCES users(sub)
    );

    CREATE TABLE favourites (
      id TEXT NOT NULL,
      user_sub TEXT NOT NULL,
      product_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (id, user_sub),
      FOREIGN KEY (user_sub) REFERENCES users(sub)
    );

    CREATE TABLE shopping_list (
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

    CREATE TABLE stock (
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
  `)

  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO users (sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run('user-a', 'a@example.com', 'Alice', null, now)
  db.prepare(
    `INSERT INTO users (sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run('user-b', 'b@example.com', 'Bob', null, now)

  db.prepare(
    `INSERT INTO products (id, user_sub, name, category, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, NULL)`,
  ).run('prod-a1', 'user-a', 'Milk', now)
  db.prepare(
    `INSERT INTO products (id, user_sub, name, category, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, NULL)`,
  ).run('prod-b1', 'user-b', 'Bread', now)

  db.prepare(
    `INSERT INTO favourites (id, user_sub, product_id, sort_order, updated_at, deleted_at) VALUES (?, ?, ?, 0, ?, NULL)`,
  ).run('fav-a1', 'user-a', 'prod-a1', now)

  db.prepare(
    `INSERT INTO shopping_list (id, user_sub, product_id, quantity, checked, updated_at, deleted_at) VALUES (?, ?, ?, NULL, 0, ?, NULL)`,
  ).run('shop-b1', 'user-b', 'prod-b1', now)

  db.prepare(
    `INSERT INTO stock (id, user_sub, product_id, quantity, status, updated_at, deleted_at) VALUES (?, ?, ?, NULL, 'in_stock', ?, NULL)`,
  ).run('stock-a1', 'user-a', 'prod-a1', now)

  db.close()
}

describe('household migration', () => {
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spesa-migrate-')), 'test.db')
  })

  afterEach(() => {
    closeDbForTests()
  })

  it('moves each user into their own owned household containing only their own rows', () => {
    seedLegacyDatabase(dbPath)
    config.dbPath = dbPath
    closeDbForTests()

    const db = getDb()

    const memberships = db
      .prepare(
        `SELECT hm.user_sub AS userSub, hm.role, h.id AS householdId
         FROM household_members hm JOIN households h ON h.id = hm.household_id`,
      )
      .all() as Array<{ userSub: string; role: string; householdId: string }>

    expect(memberships).toHaveLength(2)
    for (const row of memberships) {
      expect(row.role).toBe('owner')
    }

    const householdIdByUser = new Map(memberships.map((m) => [m.userSub, m.householdId]))
    const householdA = householdIdByUser.get('user-a')!
    const householdB = householdIdByUser.get('user-b')!
    expect(householdA).not.toBe(householdB)

    const productsA = db
      .prepare(`SELECT id FROM products WHERE household_id = ?`)
      .all(householdA) as Array<{ id: string }>
    expect(productsA.map((p) => p.id)).toEqual(['prod-a1'])

    const productsB = db
      .prepare(`SELECT id FROM products WHERE household_id = ?`)
      .all(householdB) as Array<{ id: string }>
    expect(productsB.map((p) => p.id)).toEqual(['prod-b1'])

    const favouritesA = db
      .prepare(`SELECT id FROM favourites WHERE household_id = ?`)
      .all(householdA) as Array<{ id: string }>
    expect(favouritesA.map((f) => f.id)).toEqual(['fav-a1'])

    const shoppingB = db
      .prepare(`SELECT id FROM shopping_list WHERE household_id = ?`)
      .all(householdB) as Array<{ id: string }>
    expect(shoppingB.map((s) => s.id)).toEqual(['shop-b1'])

    const stockA = db
      .prepare(`SELECT id FROM stock WHERE household_id = ?`)
      .all(householdA) as Array<{ id: string }>
    expect(stockA.map((s) => s.id)).toEqual(['stock-a1'])

    const version = db.pragma('user_version', { simple: true })
    expect(version).toBe(1)
  })

  it('is a no-op when the database is reopened after migrating', () => {
    seedLegacyDatabase(dbPath)
    config.dbPath = dbPath
    closeDbForTests()
    getDb()
    closeDbForTests()

    const before = new Database(dbPath)
    const beforeProducts = before.prepare(`SELECT COUNT(*) AS n FROM products`).get() as {
      n: number
    }
    const beforeHouseholds = before.prepare(`SELECT COUNT(*) AS n FROM households`).get() as {
      n: number
    }
    before.close()

    getDb()
    closeDbForTests()

    const after = new Database(dbPath)
    const afterProducts = after.prepare(`SELECT COUNT(*) AS n FROM products`).get() as {
      n: number
    }
    const afterHouseholds = after.prepare(`SELECT COUNT(*) AS n FROM households`).get() as {
      n: number
    }
    after.close()

    expect(afterProducts.n).toBe(beforeProducts.n)
    expect(afterHouseholds.n).toBe(beforeHouseholds.n)
    expect(afterHouseholds.n).toBe(2)
  })

  it('creates a fresh new-shape database directly, without a legacy migration', () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spesa-fresh-')), 'test.db')
    config.dbPath = dbPath
    closeDbForTests()

    const db = getDb()
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBe(1)

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(['households', 'household_members', 'household_invites', 'products']),
    )
  })
})
