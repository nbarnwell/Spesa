import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPool, upsertUser } from '../db/index.js'
import { getDefaultHouseholdId } from './households.js'
import { pullSync, pushSync, receiveDelivery, softDelete } from './sync.js'
import { setupTestDb, teardownTestDb } from '../test/db.js'
import type { SyncPushRequest } from '../types.js'

let householdId: string

beforeEach(async () => {
  await setupTestDb()
  await upsertUser({ sub: 'owner', email: 'owner@example.com' })
  householdId = (await getDefaultHouseholdId('owner'))!
})

afterEach(async () => {
  await teardownTestDb()
})

function push(partial: Partial<SyncPushRequest>): SyncPushRequest {
  // clientTime is not used by the server
  return { clientTime: new Date().toISOString(), products: [], favourites: [], shoppingList: [], stock: [], ...partial }
}

function product(id: string, updatedAt: string, name = id) {
  return { id, name, updatedAt }
}

describe('push and pull', () => {
  it('round-trips timestamps byte-identically, booleans as booleans, absent fields omitted', async () => {
    await pushSync(
      householdId,
      push({
        products: [product('p1', '2026-06-16T12:00:00.123Z')],
        shoppingList: [
          { id: 's1', productId: 'p1', checked: true, updatedAt: '2026-06-16T12:00:00.456Z' },
        ],
      }),
    )

    const pulled = await pullSync(householdId)
    expect(pulled.products).toEqual([
      { id: 'p1', name: 'p1', category: undefined, updatedAt: '2026-06-16T12:00:00.123Z', deletedAt: null },
    ])
    expect(pulled.products[0]).not.toHaveProperty('category', null)
    expect(pulled.shoppingList).toEqual([
      { id: 's1', productId: 'p1', quantity: undefined, checked: true, updatedAt: '2026-06-16T12:00:00.456Z' },
    ])
    expect(typeof pulled.shoppingList[0].checked).toBe('boolean')
  })

  it('applies newer pushes and reports older and equal ones as conflicts', async () => {
    await pushSync(householdId, push({ products: [product('p1', '2026-01-02T00:00:00.000Z', 'new')] }))

    const older = await pushSync(
      householdId,
      push({ products: [product('p1', '2026-01-01T00:00:00.000Z', 'old')] }),
    )
    expect(older.conflicts).toHaveLength(1)
    expect(older.conflicts[0]).toMatchObject({
      entity: 'product',
      id: 'p1',
      serverVersion: { name: 'new', updatedAt: '2026-01-02T00:00:00.000Z' },
    })

    const equal = await pushSync(
      householdId,
      push({ products: [product('p1', '2026-01-02T00:00:00.000Z', 'same-time')] }),
    )
    expect(equal.conflicts).toHaveLength(1)

    const newer = await pushSync(
      householdId,
      push({ products: [product('p1', '2026-01-03T00:00:00.000Z', 'newest')] }),
    )
    expect(newer.conflicts).toHaveLength(0)
    expect((await pullSync(householdId)).products[0].name).toBe('newest')
  })

  it('keeps the greatest updatedAt when pushes race', async () => {
    for (let round = 0; round < 20; round++) {
      const id = `race-${round}`
      const stamps = [1, 2, 3, 4, 5].map((n) => `2026-02-0${n}T00:00:00.000Z`)
      const shuffled = [...stamps].sort(() => Math.random() - 0.5)

      await Promise.all(
        shuffled.map((updatedAt) =>
          pushSync(householdId, push({ products: [product(id, updatedAt, updatedAt)] })),
        ),
      )

      const { rows } = await getPool().query<{ updatedAt: string }>(
        `SELECT updated_at AS "updatedAt" FROM products WHERE id = $1`,
        [id],
      )
      expect(rows[0].updatedAt).toBe('2026-02-05T00:00:00.000Z')
    }
  })

  it('does not deadlock when pushes touch the same rows in opposite order', async () => {
    const a = product('a', '2026-03-01T00:00:00.000Z')
    const b = product('b', '2026-03-01T00:00:00.000Z')

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        pushSync(
          householdId,
          push({
            products: i % 2 === 0 ? [a, b] : [b, a],
            favourites: [],
          }),
        ),
      ),
    )
    expect(results).toHaveLength(10)
  })
})

describe('softDelete', () => {
  it('leaves a tombstone visible in pull().deleted and returns false the second time', async () => {
    await pushSync(householdId, push({ products: [product('p1', '2026-01-01T00:00:00.000Z')] }))

    expect(await softDelete('products', householdId, 'p1')).toBe(true)
    expect(await softDelete('products', householdId, 'p1')).toBe(false)

    const pulled = await pullSync(householdId)
    expect(pulled.products).toHaveLength(0)
    expect(pulled.deleted.products).toEqual(['p1'])
  })
})

describe('receiveDelivery', () => {
  it('moves each list item into stock exactly once when run concurrently', async () => {
    const ts = '2026-04-01T00:00:00.000Z'
    await pushSync(
      householdId,
      push({
        products: [product('milk', ts), product('eggs', ts), product('tea', ts)],
        shoppingList: ['milk', 'eggs', 'tea'].map((p) => ({
          id: `list-${p}`,
          productId: p,
          quantity: '1',
          checked: true,
          updatedAt: ts,
        })),
      }),
    )

    const moved = await Promise.all([
      receiveDelivery(householdId, false),
      receiveDelivery(householdId, false),
      receiveDelivery(householdId, false),
    ])
    expect(moved.reduce((a, b) => a + b, 0)).toBe(3)

    const { rows } = await getPool().query<{ product_id: string }>(
      `SELECT product_id FROM stock WHERE household_id = $1 AND deleted_at IS NULL`,
      [householdId],
    )
    expect(rows.map((r) => r.product_id).sort()).toEqual(['eggs', 'milk', 'tea'])
  })

  it('only moves checked items when asked to', async () => {
    const ts = '2026-04-01T00:00:00.000Z'
    await pushSync(
      householdId,
      push({
        products: [product('milk', ts), product('eggs', ts)],
        shoppingList: [
          { id: 'l1', productId: 'milk', checked: true, updatedAt: ts },
          { id: 'l2', productId: 'eggs', checked: false, updatedAt: ts },
        ],
      }),
    )

    expect(await receiveDelivery(householdId, true)).toBe(1)
    expect((await pullSync(householdId)).shoppingList.map((i) => i.id)).toEqual(['l2'])
  })
})
