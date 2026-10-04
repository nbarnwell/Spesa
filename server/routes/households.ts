import { Router } from 'express'
import { requireRole } from '../auth/middleware.js'
import { withTransaction } from '../db/index.js'
import {
  countHouseholdsForUser,
  countMembers,
  createHousehold,
  createInvite,
  deleteHousehold,
  findPendingInvite,
  getMembership,
  joinHousehold,
  listHouseholdsForUser,
  listInvitesForEmail,
  listInvitesForHousehold,
  listMembers,
  migrateHouseholdData,
  removeMember,
  renameHousehold,
  resolveInvite,
  setMemberRole,
} from '../services/households.js'
import type { HouseholdRole } from '../types.js'

export const householdsRouter = Router()

const ALL_ROLES: HouseholdRole[] = ['owner', 'admin', 'member']
const MANAGER_ROLES: HouseholdRole[] = ['owner', 'admin']

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

householdsRouter.get('/households', async (req, res) => {
  res.json(await listHouseholdsForUser(req.user!.sub))
})

householdsRouter.post('/households', async (req, res) => {
  const { name, migrateExistingData } = req.body as {
    name?: string
    migrateExistingData?: boolean
  }
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const fromHouseholdId = req.householdId
  const household = await withTransaction(async (tx) => {
    const created = await createHousehold(name.trim(), req.user!.sub, tx)
    if (migrateExistingData && fromHouseholdId) {
      await migrateHouseholdData(fromHouseholdId, created.id, tx)
    }
    return created
  })

  res.status(201).json(household)
})

householdsRouter.patch('/households/:id', requireRole(...MANAGER_ROLES), async (req, res) => {
  const householdId = req.params.id as string
  const { name } = req.body as { name?: string }
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  await renameHousehold(householdId, name.trim())
  res.json({ id: householdId, name: name.trim() })
})

householdsRouter.delete('/households/:id', requireRole('owner'), async (req, res) => {
  const householdId = req.params.id as string
  if ((await countMembers(householdId)) > 1) {
    res.status(409).json({ error: 'Remove other members before deleting this household' })
    return
  }
  if ((await countHouseholdsForUser(req.user!.sub)) <= 1) {
    res.status(409).json({ error: 'Cannot delete your last household' })
    return
  }

  await deleteHousehold(householdId)
  res.status(204).end()
})

householdsRouter.get('/households/:id/members', requireRole(...ALL_ROLES), async (req, res) => {
  res.json(await listMembers(req.params.id as string))
})

householdsRouter.patch('/households/:id/members/:userSub', requireRole('owner'), async (req, res) => {
  const householdId = req.params.id as string
  const targetSub = req.params.userSub as string
  const { role } = req.body as { role?: HouseholdRole }
  if (!role || !ALL_ROLES.includes(role)) {
    res.status(400).json({ error: 'role must be owner, admin or member' })
    return
  }

  if (targetSub === req.user!.sub) {
    res.status(400).json({ error: 'Use another member to transfer ownership' })
    return
  }

  const targetMembership = await getMembership(householdId, targetSub)
  if (!targetMembership) {
    res.status(404).json({ error: 'Member not found' })
    return
  }

  if (role === 'owner') {
    // Ownership transfer: exactly one owner at a time, so the caller steps down to admin.
    await withTransaction(async (tx) => {
      await setMemberRole(householdId, req.user!.sub, 'admin', tx)
      await setMemberRole(householdId, targetSub, 'owner', tx)
    })
  } else {
    await setMemberRole(householdId, targetSub, role)
  }

  res.json({ userSub: targetSub, role })
})

householdsRouter.delete(
  '/households/:id/members/:userSub',
  requireRole(...ALL_ROLES),
  async (req, res) => {
    const householdId = req.params.id as string
    const targetSub = req.params.userSub as string
    const callerRole = (await getMembership(householdId, req.user!.sub))!.role
    const isSelf = targetSub === req.user!.sub

    if (!isSelf && !MANAGER_ROLES.includes(callerRole)) {
      res.status(403).json({ error: 'Insufficient role' })
      return
    }

    const targetMembership = await getMembership(householdId, targetSub)
    if (!targetMembership) {
      res.status(404).json({ error: 'Member not found' })
      return
    }

    // The owner can never be removed here, so a household can never lose its last
    // member through this endpoint — sidesteps the still-open question (issue #1) of
    // who deletes household data when its last member leaves.
    if (targetMembership.role === 'owner') {
      res.status(409).json({ error: 'The owner cannot be removed; transfer ownership first' })
      return
    }

    if (isSelf && (await countHouseholdsForUser(req.user!.sub)) <= 1) {
      res.status(409).json({ error: 'Cannot leave your last household' })
      return
    }

    await removeMember(householdId, targetSub)
    res.status(204).end()
  },
)

householdsRouter.get('/households/:id/invites', requireRole(...MANAGER_ROLES), async (req, res) => {
  res.json(await listInvitesForHousehold(req.params.id as string))
})

householdsRouter.post('/households/:id/invites', requireRole(...MANAGER_ROLES), async (req, res) => {
  const { email } = req.body as { email?: string }
  const normalized = email?.trim().toLowerCase()

  if (!normalized || !isValidEmail(normalized)) {
    res.status(400).json({ error: 'A valid email is required' })
    return
  }

  // Response is identical whether or not this email belongs to a Spesa user —
  // do not leak account existence.
  await createInvite(req.params.id as string, normalized, req.user!.sub)
  res.status(201).json({ email: normalized })
})

householdsRouter.delete('/invites/:inviteId', async (req, res) => {
  const invite = await findPendingInvite(req.params.inviteId as string)
  if (!invite || invite.status !== 'pending') {
    res.status(404).end()
    return
  }

  const membership = await getMembership(invite.householdId, req.user!.sub)
  const isManager = Boolean(membership && MANAGER_ROLES.includes(membership.role))
  const isInvitee = req.user!.emailVerified && req.user!.email.toLowerCase() === invite.email

  if (!isManager && !isInvitee) {
    res.status(403).end()
    return
  }

  await resolveInvite(invite.id, isManager ? 'revoked' : 'declined')
  res.status(204).end()
})

householdsRouter.get('/invites', async (req, res) => {
  if (!req.user!.emailVerified || !req.user!.email) {
    res.json([])
    return
  }
  res.json(await listInvitesForEmail(req.user!.email.toLowerCase()))
})

householdsRouter.post('/invites/:inviteId/accept', async (req, res) => {
  const invite = await findPendingInvite(req.params.inviteId as string)
  if (!invite || invite.status !== 'pending') {
    res.status(404).json({ error: 'Invite not found' })
    return
  }

  if (!req.user!.emailVerified || req.user!.email.toLowerCase() !== invite.email) {
    res.status(403).json({ error: 'This invite is not addressed to your verified email' })
    return
  }

  const { migrateExistingData } = req.body as { migrateExistingData?: boolean }
  const fromHouseholdId = req.householdId

  const accepted = await withTransaction(async (tx) => {
    if (!(await resolveInvite(invite.id, 'accepted', tx))) return false

    await joinHousehold(invite.householdId, req.user!.sub, tx)
    if (migrateExistingData && fromHouseholdId && fromHouseholdId !== invite.householdId) {
      await migrateHouseholdData(fromHouseholdId, invite.householdId, tx)
    }
    return true
  })

  if (!accepted) {
    res.status(404).json({ error: 'Invite not found' })
    return
  }

  res.json({ householdId: invite.householdId })
})
