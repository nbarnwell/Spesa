import { getDb, nowIso } from '../db/index.js'
import type { HouseholdRole, InviteStatus } from '../types.js'

export interface HouseholdSummary {
  id: string
  name: string
  role: HouseholdRole
  createdBy: string
  createdAt: string
}

export interface MemberSummary {
  userSub: string
  role: HouseholdRole
  joinedAt: string
  email: string
  name: string | null
}

export interface InviteSummary {
  id: string
  householdId: string
  householdName: string
  email: string
  invitedBy: string
  status: InviteStatus
  createdAt: string
  resolvedAt: string | null
}

export function getMembership(
  householdId: string,
  userSub: string,
): { role: HouseholdRole } | undefined {
  const database = getDb()
  return database
    .prepare(`SELECT role FROM household_members WHERE household_id = ? AND user_sub = ?`)
    .get(householdId, userSub) as { role: HouseholdRole } | undefined
}

export function getDefaultHouseholdId(userSub: string): string | undefined {
  const database = getDb()
  const row = database
    .prepare(
      `SELECT household_id AS householdId FROM household_members
       WHERE user_sub = ? ORDER BY joined_at ASC LIMIT 1`,
    )
    .get(userSub) as { householdId: string } | undefined
  return row?.householdId
}

export function listHouseholdsForUser(userSub: string): HouseholdSummary[] {
  const database = getDb()
  return database
    .prepare(
      `SELECT h.id, h.name, h.created_by AS createdBy, h.created_at AS createdAt, hm.role
       FROM household_members hm
       JOIN households h ON h.id = hm.household_id
       WHERE hm.user_sub = ?
       ORDER BY hm.joined_at ASC`,
    )
    .all(userSub) as HouseholdSummary[]
}

export function countHouseholdsForUser(userSub: string): number {
  const database = getDb()
  const row = database
    .prepare(`SELECT COUNT(*) AS n FROM household_members WHERE user_sub = ?`)
    .get(userSub) as { n: number }
  return row.n
}

export function countMembers(householdId: string): number {
  const database = getDb()
  const row = database
    .prepare(`SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?`)
    .get(householdId) as { n: number }
  return row.n
}

export function createHousehold(name: string, ownerSub: string): HouseholdSummary {
  const database = getDb()
  const id = crypto.randomUUID()
  const ts = nowIso()

  const run = database.transaction(() => {
    database
      .prepare(`INSERT INTO households (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, name, ownerSub, ts)
    database
      .prepare(
        `INSERT INTO household_members (household_id, user_sub, role, joined_at)
         VALUES (?, ?, 'owner', ?)`,
      )
      .run(id, ownerSub, ts)
  })
  run()

  return { id, name, role: 'owner', createdBy: ownerSub, createdAt: ts }
}

export function renameHousehold(householdId: string, name: string): void {
  const database = getDb()
  database.prepare(`UPDATE households SET name = ? WHERE id = ?`).run(name, householdId)
}

const DATA_TABLES = ['products', 'favourites', 'shopping_list', 'stock'] as const

export function deleteHousehold(householdId: string): void {
  const database = getDb()
  const run = database.transaction(() => {
    for (const table of DATA_TABLES) {
      database.prepare(`DELETE FROM ${table} WHERE household_id = ?`).run(householdId)
    }
    database.prepare(`DELETE FROM household_invites WHERE household_id = ?`).run(householdId)
    database.prepare(`DELETE FROM household_members WHERE household_id = ?`).run(householdId)
    database.prepare(`DELETE FROM households WHERE id = ?`).run(householdId)
  })
  run()
}

export function listMembers(householdId: string): MemberSummary[] {
  const database = getDb()
  return database
    .prepare(
      `SELECT hm.user_sub AS userSub, hm.role, hm.joined_at AS joinedAt, u.email, u.name
       FROM household_members hm
       JOIN users u ON u.sub = hm.user_sub
       WHERE hm.household_id = ?
       ORDER BY hm.joined_at ASC`,
    )
    .all(householdId) as MemberSummary[]
}

export function setMemberRole(householdId: string, userSub: string, role: HouseholdRole): void {
  const database = getDb()
  database
    .prepare(`UPDATE household_members SET role = ? WHERE household_id = ? AND user_sub = ?`)
    .run(role, householdId, userSub)
}

export function removeMember(householdId: string, userSub: string): void {
  const database = getDb()
  database
    .prepare(`DELETE FROM household_members WHERE household_id = ? AND user_sub = ?`)
    .run(householdId, userSub)
}

export function listInvitesForHousehold(householdId: string): InviteSummary[] {
  const database = getDb()
  return database
    .prepare(
      `SELECT i.id, i.household_id AS householdId, h.name AS householdName, i.email,
              i.invited_by AS invitedBy, i.status, i.created_at AS createdAt, i.resolved_at AS resolvedAt
       FROM household_invites i
       JOIN households h ON h.id = i.household_id
       WHERE i.household_id = ? AND i.status = 'pending'
       ORDER BY i.created_at ASC`,
    )
    .all(householdId) as InviteSummary[]
}

export function findPendingInvite(inviteId: string): InviteSummary | undefined {
  const database = getDb()
  return database
    .prepare(
      `SELECT i.id, i.household_id AS householdId, h.name AS householdName, i.email,
              i.invited_by AS invitedBy, i.status, i.created_at AS createdAt, i.resolved_at AS resolvedAt
       FROM household_invites i
       JOIN households h ON h.id = i.household_id
       WHERE i.id = ?`,
    )
    .get(inviteId) as InviteSummary | undefined
}

/** Returns true if created, false if a pending invite for this household/email already exists. */
export function createInvite(householdId: string, email: string, invitedBy: string): boolean {
  const database = getDb()
  const existing = database
    .prepare(
      `SELECT 1 FROM household_invites WHERE household_id = ? AND email = ? AND status = 'pending'`,
    )
    .get(householdId, email)
  if (existing) return false

  database
    .prepare(
      `INSERT INTO household_invites (id, household_id, email, invited_by, status, created_at, resolved_at)
       VALUES (?, ?, ?, ?, 'pending', ?, NULL)`,
    )
    .run(crypto.randomUUID(), householdId, email, invitedBy, nowIso())
  return true
}

export function resolveInvite(inviteId: string, status: Exclude<InviteStatus, 'pending'>): void {
  const database = getDb()
  database
    .prepare(
      `UPDATE household_invites SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`,
    )
    .run(status, nowIso(), inviteId)
}

export function listInvitesForEmail(email: string): InviteSummary[] {
  const database = getDb()
  return database
    .prepare(
      `SELECT i.id, i.household_id AS householdId, h.name AS householdName, i.email,
              i.invited_by AS invitedBy, i.status, i.created_at AS createdAt, i.resolved_at AS resolvedAt
       FROM household_invites i
       JOIN households h ON h.id = i.household_id
       WHERE i.email = ? AND i.status = 'pending'
       ORDER BY i.created_at ASC`,
    )
    .all(email) as InviteSummary[]
}

export function joinHousehold(householdId: string, userSub: string): void {
  const database = getDb()
  database
    .prepare(
      `INSERT INTO household_members (household_id, user_sub, role, joined_at)
       VALUES (?, ?, 'member', ?)
       ON CONFLICT(household_id, user_sub) DO NOTHING`,
    )
    .run(householdId, userSub, nowIso())
}

/**
 * Moves the caller's rows from one household into another, de-duplicating products
 * by lowercased name so joining two households doesn't create duplicate products.
 */
export function migrateHouseholdData(fromHouseholdId: string, toHouseholdId: string): void {
  const database = getDb()

  const run = database.transaction(() => {
    const sourceProducts = database
      .prepare(`SELECT id, name FROM products WHERE household_id = ? AND deleted_at IS NULL`)
      .all(fromHouseholdId) as Array<{ id: string; name: string }>

    const destProducts = database
      .prepare(`SELECT id, name FROM products WHERE household_id = ? AND deleted_at IS NULL`)
      .all(toHouseholdId) as Array<{ id: string; name: string }>

    const destByLowerName = new Map(destProducts.map((p) => [p.name.toLowerCase(), p.id]))
    const productIdRemap = new Map<string, string>()

    for (const product of sourceProducts) {
      const existingId = destByLowerName.get(product.name.toLowerCase())
      if (existingId) {
        productIdRemap.set(product.id, existingId)
      }
    }

    for (const [oldId] of productIdRemap) {
      database
        .prepare(`DELETE FROM products WHERE id = ? AND household_id = ?`)
        .run(oldId, fromHouseholdId)
    }

    database
      .prepare(`UPDATE products SET household_id = ? WHERE household_id = ?`)
      .run(toHouseholdId, fromHouseholdId)

    for (const table of ['favourites', 'shopping_list', 'stock'] as const) {
      database
        .prepare(`UPDATE ${table} SET household_id = ? WHERE household_id = ?`)
        .run(toHouseholdId, fromHouseholdId)

      for (const [oldProductId, newProductId] of productIdRemap) {
        database
          .prepare(
            `UPDATE ${table} SET product_id = ? WHERE product_id = ? AND household_id = ?`,
          )
          .run(newProductId, oldProductId, toHouseholdId)
      }
    }
  })

  run()
}
