import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { closeDbForTests } from '../db/index.js'

vi.mock('../auth/google.js', async () => {
  const actual = await vi.importActual<typeof import('../auth/google.js')>('../auth/google.js')
  return { ...actual, authenticateBearerToken: vi.fn() }
})

const { authenticateBearerToken } = await import('../auth/google.js')
const { createApp } = await import('../app.js')

interface Profile {
  sub: string
  email: string
  emailVerified: boolean
  name?: string
}

interface MeResponse {
  sub: string
  activeHouseholdId: string
}

interface InviteResponse {
  id: string
}

interface MemberResponse {
  userSub: string
  role: string
}

interface HouseholdResponse {
  id: string
  name: string
}

interface ProductResponse {
  name: string
}

const profiles = new Map<string, Profile>()

let server: http.Server
let baseUrl: string

function registerUser(token: string, profile: Profile): void {
  profiles.set(token, profile)
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function authFetch(
  pathName: string,
  token: string,
  init?: RequestInit & { householdId?: string },
): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${token}`)
  headers.set('content-type', 'application/json')
  if (init?.householdId) headers.set('x-household-id', init.householdId)
  return fetch(`${baseUrl}${pathName}`, { ...init, headers })
}

beforeEach(async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spesa-households-')), 'test.db')
  config.dbPath = dbPath
  closeDbForTests()
  profiles.clear()

  vi.mocked(authenticateBearerToken).mockReset()
  vi.mocked(authenticateBearerToken).mockImplementation(async (token: string) => {
    const profile = profiles.get(token)
    if (!profile) throw new Error('unknown token')
    return profile
  })

  const app = createApp()
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  closeDbForTests()
})

describe('household invite lifecycle and role rules', () => {
  it('lets an invited user join, then blocks the owner from being removed', async () => {
    registerUser('owner-token', { sub: 'owner', email: 'owner@example.com', emailVerified: true })
    registerUser('member-token', { sub: 'member', email: 'member@example.com', emailVerified: true })

    const ownerMe = await readJson<MeResponse>(await authFetch('/api/me', 'owner-token'))
    const householdId = ownerMe.activeHouseholdId

    const inviteRes = await authFetch(`/api/households/${householdId}/invites`, 'owner-token', {
      method: 'POST',
      body: JSON.stringify({ email: 'member@example.com' }),
    })
    expect(inviteRes.status).toBe(201)

    await authFetch('/api/me', 'member-token') // ensures member's own personal household exists

    const invitesForMember = await readJson<InviteResponse[]>(
      await authFetch('/api/invites', 'member-token'),
    )
    expect(invitesForMember).toHaveLength(1)
    const inviteId = invitesForMember[0].id

    const acceptRes = await authFetch(`/api/invites/${inviteId}/accept`, 'member-token', {
      method: 'POST',
      body: JSON.stringify({ migrateExistingData: false }),
    })
    expect(acceptRes.status).toBe(200)

    const members = await readJson<MemberResponse[]>(
      await authFetch(`/api/households/${householdId}/members`, 'owner-token'),
    )
    expect(members.map((m) => m.userSub).sort()).toEqual(['member', 'owner'])

    const removeOwnerRes = await authFetch(
      `/api/households/${householdId}/members/owner`,
      'owner-token',
      { method: 'DELETE' },
    )
    expect(removeOwnerRes.status).toBe(409)

    const removeByMemberRes = await authFetch(
      `/api/households/${householdId}/members/owner`,
      'member-token',
      { method: 'DELETE' },
    )
    expect(removeByMemberRes.status).toBe(403)
  })

  it('lets a member leave a non-last household but blocks leaving their last one', async () => {
    registerUser('owner-token', { sub: 'owner', email: 'owner@example.com', emailVerified: true })
    registerUser('member-token', { sub: 'member', email: 'member@example.com', emailVerified: true })

    const ownerMe = await readJson<MeResponse>(await authFetch('/api/me', 'owner-token'))
    const householdId = ownerMe.activeHouseholdId

    await authFetch(`/api/households/${householdId}/invites`, 'owner-token', {
      method: 'POST',
      body: JSON.stringify({ email: 'member@example.com' }),
    })
    const memberMe = await readJson<MeResponse>(await authFetch('/api/me', 'member-token'))
    const personalHouseholdId = memberMe.activeHouseholdId

    const invites = await readJson<InviteResponse[]>(
      await authFetch('/api/invites', 'member-token'),
    )
    await authFetch(`/api/invites/${invites[0].id}/accept`, 'member-token', {
      method: 'POST',
      body: JSON.stringify({ migrateExistingData: false }),
    })

    const leaveSharedRes = await authFetch(
      `/api/households/${householdId}/members/member`,
      'member-token',
      { method: 'DELETE' },
    )
    expect(leaveSharedRes.status).toBe(204)

    const leaveLastRes = await authFetch(
      `/api/households/${personalHouseholdId}/members/member`,
      'member-token',
      { method: 'DELETE' },
    )
    expect(leaveLastRes.status).toBe(409)
  })

  it('transfers ownership when a member is promoted to owner', async () => {
    registerUser('owner-token', { sub: 'owner', email: 'owner@example.com', emailVerified: true })
    registerUser('member-token', { sub: 'member', email: 'member@example.com', emailVerified: true })

    const ownerMe = await readJson<MeResponse>(await authFetch('/api/me', 'owner-token'))
    const householdId = ownerMe.activeHouseholdId

    await authFetch(`/api/households/${householdId}/invites`, 'owner-token', {
      method: 'POST',
      body: JSON.stringify({ email: 'member@example.com' }),
    })
    await authFetch('/api/me', 'member-token')
    const invites = await readJson<InviteResponse[]>(
      await authFetch('/api/invites', 'member-token'),
    )
    await authFetch(`/api/invites/${invites[0].id}/accept`, 'member-token', {
      method: 'POST',
      body: JSON.stringify({ migrateExistingData: false }),
    })

    const transferRes = await authFetch(
      `/api/households/${householdId}/members/member`,
      'owner-token',
      { method: 'PATCH', body: JSON.stringify({ role: 'owner' }) },
    )
    expect(transferRes.status).toBe(200)

    const members = await readJson<MemberResponse[]>(
      await authFetch(`/api/households/${householdId}/members`, 'owner-token'),
    )
    const byId = new Map(members.map((m) => [m.userSub, m.role]))
    expect(byId.get('member')).toBe('owner')
    expect(byId.get('owner')).toBe('admin')
  })

  it('deduplicates products by name when migrating data into a new household', async () => {
    registerUser('owner-token', { sub: 'owner', email: 'owner@example.com', emailVerified: true })

    await authFetch('/api/me', 'owner-token')
    await authFetch('/api/products', 'owner-token', {
      method: 'POST',
      body: JSON.stringify({ name: 'Milk' }),
    })

    const createRes = await authFetch('/api/households', 'owner-token', {
      method: 'POST',
      body: JSON.stringify({ name: 'Family', migrateExistingData: true }),
    })
    const newHousehold = await readJson<HouseholdResponse>(createRes)

    const productsInNew = await readJson<ProductResponse[]>(
      await authFetch('/api/products', 'owner-token', { householdId: newHousehold.id }),
    )
    expect(productsInNew.map((p) => p.name)).toEqual(['Milk'])
  })
})
