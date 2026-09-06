import { db, dropHouseholdData } from '../db/database'
import { getActiveHouseholdId } from '../household/activeHousehold'
import type { PendingSyncOp } from '../types'
import { LOCAL_HOUSEHOLD_ID } from '../types'
import { newId, nowIso } from '../lib/ids'
import {
  BFF_ROUTES,
  type HouseholdRole,
  type HouseholdSummary,
  type InviteSummary,
  type MemberSummary,
  type SyncPullResponse,
  type SyncPushRequest,
  type UserProfile,
} from './contract'

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

  const householdId = getActiveHouseholdId()
  if (householdId !== LOCAL_HOUSEHOLD_ID) {
    headers.set('X-Household-Id', householdId)
  }

  const url = `${baseUrl()}${path}`
  return fetch(url, { ...init, headers })
}

export async function getMe(accessToken: string): Promise<UserProfile> {
  const res = await fetchWithAuth(BFF_ROUTES.me, accessToken)
  if (!res.ok) throw new Error(`GET /api/me failed: ${res.status}`)
  return res.json() as Promise<UserProfile>
}

async function assertSyncOk(res: Response, label: string): Promise<void> {
  if (res.ok) return
  if (res.status === 403) {
    // We're no longer a member of this household (e.g. removed by the owner) — the
    // data was already on this device, so this is cleanup, not enforcement.
    await dropHouseholdData(getActiveHouseholdId())
  }
  throw new Error(`${label} failed: ${res.status}`)
}

export async function pullSync(accessToken: string, since?: string): Promise<SyncPullResponse> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : ''
  const res = await fetchWithAuth(`${BFF_ROUTES.syncPull}${qs}`, accessToken)
  await assertSyncOk(res, 'Sync pull')
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
  await assertSyncOk(res, 'Sync push')
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
  const householdId = getActiveHouseholdId()

  await db.transaction('rw', db.products, db.favourites, db.shoppingList, db.stock, async () => {
    for (const id of data.deleted.products) await db.products.delete(id)
    for (const id of data.deleted.favourites) await db.favourites.delete(id)
    for (const id of data.deleted.shoppingList) await db.shoppingList.delete(id)
    for (const id of data.deleted.stock) await db.stock.delete(id)

    for (const p of data.products) {
      await db.products.put({ ...p, householdId, syncStatus: 'synced' })
    }
    for (const f of data.favourites) {
      await db.favourites.put({ ...f, householdId, syncStatus: 'synced' })
    }
    for (const s of data.shoppingList) {
      await db.shoppingList.put({ ...s, householdId, syncStatus: 'synced' })
    }
    for (const s of data.stock) {
      await db.stock.put({ ...s, householdId, syncStatus: 'synced' })
    }
  })
}

export async function listHouseholds(accessToken: string): Promise<HouseholdSummary[]> {
  const res = await fetchWithAuth(BFF_ROUTES.households, accessToken)
  if (!res.ok) throw new Error(`GET /api/households failed: ${res.status}`)
  return res.json() as Promise<HouseholdSummary[]>
}

export async function createHousehold(
  accessToken: string,
  name: string,
  migrateExistingData: boolean,
): Promise<HouseholdSummary> {
  const res = await fetchWithAuth(BFF_ROUTES.households, accessToken, {
    method: 'POST',
    body: JSON.stringify({ name, migrateExistingData }),
  })
  if (!res.ok) throw new Error(`POST /api/households failed: ${res.status}`)
  return res.json() as Promise<HouseholdSummary>
}

export async function renameHousehold(
  accessToken: string,
  householdId: string,
  name: string,
): Promise<void> {
  const res = await fetchWithAuth(BFF_ROUTES.household(householdId), accessToken, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`PATCH ${BFF_ROUTES.household(householdId)} failed: ${res.status}`)
}

export async function deleteHousehold(accessToken: string, householdId: string): Promise<void> {
  const res = await fetchWithAuth(BFF_ROUTES.household(householdId), accessToken, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`DELETE ${BFF_ROUTES.household(householdId)} failed: ${res.status}`)
}

export async function listMembers(
  accessToken: string,
  householdId: string,
): Promise<MemberSummary[]> {
  const res = await fetchWithAuth(BFF_ROUTES.householdMembers(householdId), accessToken)
  if (!res.ok) throw new Error(`GET household members failed: ${res.status}`)
  return res.json() as Promise<MemberSummary[]>
}

export async function setMemberRole(
  accessToken: string,
  householdId: string,
  userSub: string,
  role: HouseholdRole,
): Promise<void> {
  const res = await fetchWithAuth(BFF_ROUTES.householdMember(householdId, userSub), accessToken, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
  if (!res.ok) throw new Error(`PATCH member role failed: ${res.status}`)
}

export async function removeMember(
  accessToken: string,
  householdId: string,
  userSub: string,
): Promise<void> {
  const res = await fetchWithAuth(BFF_ROUTES.householdMember(householdId, userSub), accessToken, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`DELETE member failed: ${res.status}`)
}

export async function listHouseholdInvites(
  accessToken: string,
  householdId: string,
): Promise<InviteSummary[]> {
  const res = await fetchWithAuth(BFF_ROUTES.householdInvites(householdId), accessToken)
  if (!res.ok) throw new Error(`GET household invites failed: ${res.status}`)
  return res.json() as Promise<InviteSummary[]>
}

export async function createInvite(
  accessToken: string,
  householdId: string,
  email: string,
): Promise<void> {
  const res = await fetchWithAuth(BFF_ROUTES.householdInvites(householdId), accessToken, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`POST household invite failed: ${res.status}`)
}

export async function revokeOrDeclineInvite(accessToken: string, inviteId: string): Promise<void> {
  const res = await fetchWithAuth(BFF_ROUTES.invite(inviteId), accessToken, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE invite failed: ${res.status}`)
}

export async function listMyInvites(accessToken: string): Promise<InviteSummary[]> {
  const res = await fetchWithAuth(BFF_ROUTES.myInvites, accessToken)
  if (!res.ok) throw new Error(`GET /api/invites failed: ${res.status}`)
  return res.json() as Promise<InviteSummary[]>
}

export async function acceptInvite(
  accessToken: string,
  inviteId: string,
  migrateExistingData: boolean,
): Promise<{ householdId: string }> {
  const res = await fetchWithAuth(BFF_ROUTES.acceptInvite(inviteId), accessToken, {
    method: 'POST',
    body: JSON.stringify({ migrateExistingData }),
  })
  if (!res.ok) throw new Error(`POST accept invite failed: ${res.status}`)
  return res.json() as Promise<{ householdId: string }>
}
