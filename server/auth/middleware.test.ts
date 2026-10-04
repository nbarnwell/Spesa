import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { setupTestDb, teardownTestDb } from '../test/db.js'
import { upsertUser } from '../db/index.js'
import { getDefaultHouseholdId } from '../services/households.js'

vi.mock('./google.js', async () => {
  const actual = await vi.importActual<typeof import('./google.js')>('./google.js')
  return {
    ...actual,
    authenticateBearerToken: vi.fn(),
  }
})

const { authenticateBearerToken } = await import('./google.js')
const { requireAuth } = await import('./middleware.js')

function createMockResponse(): Response {
  const res = {} as Response
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  res.end = vi.fn().mockReturnValue(res)
  return res
}

describe('requireAuth household boundary', () => {
  beforeEach(async () => {
    await setupTestDb()
    vi.mocked(authenticateBearerToken).mockReset()
  })

  afterEach(async () => {
    await teardownTestDb()
  })

  it('responds 403 when the caller is not a member of the requested household', async () => {
    await upsertUser({ sub: 'user-a', email: 'a@example.com' })
    await upsertUser({ sub: 'user-b', email: 'b@example.com' })
    const householdB = (await getDefaultHouseholdId('user-b'))!

    vi.mocked(authenticateBearerToken).mockResolvedValue({
      sub: 'user-a',
      email: 'a@example.com',
      emailVerified: true,
    })

    const req = {
      headers: { authorization: 'Bearer token-a', 'x-household-id': householdB },
    } as unknown as Request
    const res = createMockResponse()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('allows the caller into their own household and sets req.householdId/Role', async () => {
    await upsertUser({ sub: 'user-a', email: 'a@example.com' })
    const householdA = (await getDefaultHouseholdId('user-a'))!

    vi.mocked(authenticateBearerToken).mockResolvedValue({
      sub: 'user-a',
      email: 'a@example.com',
      emailVerified: true,
    })

    const req = { headers: { authorization: 'Bearer token-a' } } as unknown as Request
    const res = createMockResponse()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.householdId).toBe(householdA)
    expect(req.householdRole).toBe('owner')
  })

  it('responds 401 when no bearer token is present', async () => {
    const req = { headers: {} } as unknown as Request
    const res = createMockResponse()
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
  })
})
