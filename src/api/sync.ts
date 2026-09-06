import { db } from '../db/database'
import { getActiveHouseholdId } from '../household/activeHousehold'
import { nowIso } from '../lib/ids'
import type { SyncPushRequest } from './contract'
import { applyPullToLocal, flushSyncQueue, pullSync, pushSync } from './client'

export async function gatherLocalSyncPayload(): Promise<SyncPushRequest> {
  const householdId = getActiveHouseholdId()

  const [products, favourites, shoppingList, stock] = await Promise.all([
    db.products.where('householdId').equals(householdId).toArray(),
    db.favourites.where('householdId').equals(householdId).toArray(),
    db.shoppingList.where('householdId').equals(householdId).toArray(),
    db.stock.where('householdId').equals(householdId).toArray(),
  ])

  return {
    clientTime: nowIso(),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      updatedAt: p.updatedAt,
    })),
    favourites: favourites.map((f) => ({
      id: f.id,
      productId: f.productId,
      sortOrder: f.sortOrder,
      updatedAt: f.updatedAt,
    })),
    shoppingList: shoppingList.map((s) => ({
      id: s.id,
      productId: s.productId,
      quantity: s.quantity,
      checked: s.checked,
      updatedAt: s.updatedAt,
    })),
    stock: stock.map((s) => ({
      id: s.id,
      productId: s.productId,
      quantity: s.quantity,
      status: s.status,
      updatedAt: s.updatedAt,
    })),
  }
}

/** Push local state to server, then pull server changes (including tombstones). */
export async function fullSync(accessToken: string): Promise<void> {
  await flushSyncQueue(accessToken)
  const payload = await gatherLocalSyncPayload()
  await pushSync(accessToken, payload)
  const data = await pullSync(accessToken)
  await applyPullToLocal(data)

  const householdId = getActiveHouseholdId()

  await db.transaction('rw', db.products, db.favourites, db.shoppingList, db.stock, async () => {
    for (const p of await db.products.where('householdId').equals(householdId).toArray()) {
      if (p.syncStatus !== 'synced') {
        await db.products.update(p.id, { syncStatus: 'synced' })
      }
    }
    for (const f of await db.favourites.where('householdId').equals(householdId).toArray()) {
      if (f.syncStatus !== 'synced') {
        await db.favourites.update(f.id, { syncStatus: 'synced' })
      }
    }
    for (const s of await db.shoppingList.where('householdId').equals(householdId).toArray()) {
      if (s.syncStatus !== 'synced') {
        await db.shoppingList.update(s.id, { syncStatus: 'synced' })
      }
    }
    for (const s of await db.stock.where('householdId').equals(householdId).toArray()) {
      if (s.syncStatus !== 'synced') {
        await db.stock.update(s.id, { syncStatus: 'synced' })
      }
    }
  })
}
