import type { NextFunction, Request, Response } from 'express'
import { authenticateBearerToken, extractBearerToken } from './google.js'
import { upsertUser } from '../db/index.js'

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

  try {
    const user = await authenticateBearerToken(token)
    upsertUser(user)
    req.user = user
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
