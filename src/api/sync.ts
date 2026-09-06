import { db } from '../db/database'
import { nowIso } from '../lib/ids'
import type { SyncPushRequest } from './contract'
import { applyPullToLocal, flushSyncQueue, pullSync, pushSync } from './client'

export async function gatherLocalSyncPayload(): Promise<SyncPushRequest> {
  const [products, favourites, shoppingList, stock] = await Promise.all([
    db.products.toArray(),
    db.favourites.toArray(),
    db.shoppingList.toArray(),
    db.stock.toArray(),
  ])

  return {
    clientTime: nowIso(),
    products: products.map(({ syncStatus: _, ...p }) => p),
    favourites: favourites.map(({ syncStatus: _, ...f }) => f),
    shoppingList: shoppingList.map(({ syncStatus: _, ...s }) => s),
    stock: stock.map(({ syncStatus: _, ...s }) => s),
  }
}

/** Push local state to server, then pull server changes (including tombstones). */
export async function fullSync(accessToken: string): Promise<void> {
  await flushSyncQueue(accessToken)
  const payload = await gatherLocalSyncPayload()
  await pushSync(accessToken, payload)
  const data = await pullSync(accessToken)
  await applyPullToLocal(data)

  await db.transaction('rw', db.products, db.favourites, db.shoppingList, db.stock, async () => {
    for (const p of await db.products.toArray()) {
      if (p.syncStatus !== 'synced') {
        await db.products.update(p.id, { syncStatus: 'synced' })
      }
    }
    for (const f of await db.favourites.toArray()) {
      if (f.syncStatus !== 'synced') {
        await db.favourites.update(f.id, { syncStatus: 'synced' })
      }
    }
    for (const s of await db.shoppingList.toArray()) {
      if (s.syncStatus !== 'synced') {
        await db.shoppingList.update(s.id, { syncStatus: 'synced' })
      }
    }
    for (const s of await db.stock.toArray()) {
      if (s.syncStatus !== 'synced') {
        await db.stock.update(s.id, { syncStatus: 'synced' })
      }
    }
  })
}
