import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { config } from '../config.js'
import { closeDbForTests, upsertUser } from '../db/index.js'
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
  beforeEach(() => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spesa-auth-')), 'test.db')
    config.dbPath = dbPath
    closeDbForTests()
    vi.mocked(authenticateBearerToken).mockReset()
  })

  afterEach(() => {
    closeDbForTests()
  })

  it('responds 403 when the caller is not a member of the requested household', async () => {
    upsertUser({ sub: 'user-a', email: 'a@example.com' })
    upsertUser({ sub: 'user-b', email: 'b@example.com' })
    const householdB = getDefaultHouseholdId('user-b')!

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
    upsertUser({ sub: 'user-a', email: 'a@example.com' })
    const householdA = getDefaultHouseholdId('user-a')!

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
