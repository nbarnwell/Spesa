import { db } from '../db/database'
import type { PendingSyncOp } from '../types'
import { newId, nowIso } from '../lib/ids'
import { BFF_ROUTES, type SyncPullResponse, type SyncPushRequest, type UserProfile } from './contract'

const baseUrl = () => import.meta.env.VITE_BFF_BASE_URL?.replace(/\/$/, '') ?? ''

/** BFF is served from the same origin; optional VITE_BFF_BASE_URL overrides for split deploy. */
export function isBffConfigured(): boolean {
  return true
}

export async function enqueueSync(op: Omit<PendingSyncOp, 'id' | 'createdAt'>): Promise<void> {
  await db.syncQueue.add({
    id: newId(),
    ...op,
    createdAt: nowIso(),
  })
}

async function fetchWithAuth(
  path: string,
  accessToken: string | null,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  const url = `${baseUrl()}${path}`
  return fetch(url, { ...init, headers })
}

export async function getMe(accessToken: string): Promise<UserProfile> {
  const res = await fetchWithAuth(BFF_ROUTES.me, accessToken)
  if (!res.ok) throw new Error(`GET /api/me failed: ${res.status}`)
  return res.json() as Promise<UserProfile>
}

export async function pullSync(accessToken: string, since?: string): Promise<SyncPullResponse> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : ''
  const res = await fetchWithAuth(`${BFF_ROUTES.syncPull}${qs}`, accessToken)
  if (!res.ok) throw new Error(`Sync pull failed: ${res.status}`)
  return res.json() as Promise<SyncPullResponse>
}

export async function pushSync(
  accessToken: string,
  payload: SyncPushRequest,
): Promise<void> {
  const res = await fetchWithAuth(BFF_ROUTES.syncPush, accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Sync push failed: ${res.status}`)
}

export async function flushSyncQueue(accessToken: string | null): Promise<void> {
  if (!accessToken || !isBffConfigured()) return

  const queue = await db.syncQueue.orderBy('createdAt').toArray()
  for (const op of queue) {
    const res = await fetchWithAuth(op.path, accessToken, {
      method: op.method,
      body: op.body !== undefined ? JSON.stringify(op.body) : undefined,
    })
    if (res.ok) {
      await db.syncQueue.delete(op.id)
    } else {
      break
    }
  }
}

export async function applyPullToLocal(data: SyncPullResponse): Promise<void> {
  await db.transaction('rw', db.products, db.favourites, db.shoppingList, db.stock, async () => {
    for (const id of data.deleted.products) await db.products.delete(id)
    for (const id of data.deleted.favourites) await db.favourites.delete(id)
    for (const id of data.deleted.shoppingList) await db.shoppingList.delete(id)
    for (const id of data.deleted.stock) await db.stock.delete(id)

    for (const p of data.products) {
      await db.products.put({ ...p, syncStatus: 'synced' })
    }
    for (const f of data.favourites) {
      await db.favourites.put({ ...f, syncStatus: 'synced' })
    }
    for (const s of data.shoppingList) {
      await db.shoppingList.put({ ...s, syncStatus: 'synced' })
    }
    for (const s of data.stock) {
      await db.stock.put({ ...s, syncStatus: 'synced' })
    }
  })
}
