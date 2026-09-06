import type { NextFunction, Request, Response } from 'express'
import { authenticateBearerToken, extractBearerToken } from './google.js'
import { upsertUser } from '../db/index.js'
import { getDefaultHouseholdId, getMembership } from '../services/households.js'
import type { HouseholdRole } from '../types.js'

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization)
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return
  }

  let user
  try {
    user = await authenticateBearerToken(token)
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  upsertUser(user)
  req.user = user

  const headerValue = req.headers['x-household-id']
  const requestedHouseholdId = typeof headerValue === 'string' ? headerValue : undefined
  const householdId = requestedHouseholdId ?? getDefaultHouseholdId(user.sub)

  if (!householdId) {
    res.status(403).json({ error: 'No household membership' })
    return
  }

  const membership = getMembership(householdId, user.sub)
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this household' })
    return
  }

  req.householdId = householdId
  req.householdRole = membership.role
  next()
}

/**
 * Authorizes against the household named by the :id route param — distinct from
 * req.householdRole, which reflects the caller's *active* household and may differ
 * from the one a management route is targeting.
 */
export function requireRole(...roles: HouseholdRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const householdId = req.params.id as string | undefined
    const membership = householdId ? getMembership(householdId, req.user!.sub) : undefined
    if (!membership) {
      res.status(404).json({ error: 'Household not found' })
      return
    }
    if (!roles.includes(membership.role)) {
      res.status(403).json({ error: 'Insufficient role' })
      return
    }
    next()
  }
}
