import { getPool, nowIso, withTransaction, type Queryable } from '../db/index.js'
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

const INVITE_COLUMNS = `i.id, i.household_id AS "householdId", h.name AS "householdName", i.email,
              i.invited_by AS "invitedBy", i.status, i.created_at AS "createdAt", i.resolved_at AS "resolvedAt"`

/** Runs `fn` on the caller's transaction if one was passed, otherwise opens its own. */
async function inTransaction<T>(
  db: Queryable | undefined,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  return db ? fn(db) : withTransaction(fn)
}

export async function getMembership(
  householdId: string,
  userSub: string,
  db: Queryable = getPool(),
): Promise<{ role: HouseholdRole } | undefined> {
  const { rows } = await db.query<{ role: HouseholdRole }>(
    `SELECT role FROM household_members WHERE household_id = $1 AND user_sub = $2`,
    [householdId, userSub],
  )
  return rows[0]
}

export async function getDefaultHouseholdId(
  userSub: string,
  db: Queryable = getPool(),
): Promise<string | undefined> {
  const { rows } = await db.query<{ householdId: string }>(
    `SELECT household_id AS "householdId" FROM household_members
     WHERE user_sub = $1 ORDER BY joined_at ASC LIMIT 1`,
    [userSub],
  )
  return rows[0]?.householdId
}

export async function listHouseholdsForUser(
  userSub: string,
  db: Queryable = getPool(),
): Promise<HouseholdSummary[]> {
  const { rows } = await db.query<HouseholdSummary>(
    `SELECT h.id, h.name, h.created_by AS "createdBy", h.created_at AS "createdAt", hm.role
     FROM household_members hm
     JOIN households h ON h.id = hm.household_id
     WHERE hm.user_sub = $1
     ORDER BY hm.joined_at ASC`,
    [userSub],
  )
  return rows
}

export async function countHouseholdsForUser(
  userSub: string,
  db: Queryable = getPool(),
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM household_members WHERE user_sub = $1`,
    [userSub],
  )
  return rows[0].n
}

export async function countMembers(
  householdId: string,
  db: Queryable = getPool(),
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM household_members WHERE household_id = $1`,
    [householdId],
  )
  return rows[0].n
}

export async function createHousehold(
  name: string,
  ownerSub: string,
  db?: Queryable,
): Promise<HouseholdSummary> {
  const id = crypto.randomUUID()
  const ts = nowIso()

  await inTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO households (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)`,
      [id, name, ownerSub, ts],
    )
    await tx.query(
      `INSERT INTO household_members (household_id, user_sub, role, joined_at)
       VALUES ($1, $2, 'owner', $3)`,
      [id, ownerSub, ts],
    )
  })

  return { id, name, role: 'owner', createdBy: ownerSub, createdAt: ts }
}

export async function renameHousehold(
  householdId: string,
  name: string,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(`UPDATE households SET name = $1 WHERE id = $2`, [name, householdId])
}

const DATA_TABLES = ['products', 'favourites', 'shopping_list', 'stock'] as const

export async function deleteHousehold(householdId: string, db?: Queryable): Promise<void> {
  await inTransaction(db, async (tx) => {
    for (const table of DATA_TABLES) {
      await tx.query(`DELETE FROM ${table} WHERE household_id = $1`, [householdId])
    }
    await tx.query(`DELETE FROM household_invites WHERE household_id = $1`, [householdId])
    await tx.query(`DELETE FROM household_members WHERE household_id = $1`, [householdId])
    await tx.query(`DELETE FROM households WHERE id = $1`, [householdId])
  })
}

export async function listMembers(
  householdId: string,
  db: Queryable = getPool(),
): Promise<MemberSummary[]> {
  const { rows } = await db.query<MemberSummary>(
    `SELECT hm.user_sub AS "userSub", hm.role, hm.joined_at AS "joinedAt", u.email, u.name
     FROM household_members hm
     JOIN users u ON u.sub = hm.user_sub
     WHERE hm.household_id = $1
     ORDER BY hm.joined_at ASC`,
    [householdId],
  )
  return rows
}

export async function setMemberRole(
  householdId: string,
  userSub: string,
  role: HouseholdRole,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `UPDATE household_members SET role = $1 WHERE household_id = $2 AND user_sub = $3`,
    [role, householdId, userSub],
  )
}

export async function removeMember(
  householdId: string,
  userSub: string,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(`DELETE FROM household_members WHERE household_id = $1 AND user_sub = $2`, [
    householdId,
    userSub,
  ])
}

export async function listInvitesForHousehold(
  householdId: string,
  db: Queryable = getPool(),
): Promise<InviteSummary[]> {
  const { rows } = await db.query<InviteSummary>(
    `SELECT ${INVITE_COLUMNS}
     FROM household_invites i
     JOIN households h ON h.id = i.household_id
     WHERE i.household_id = $1 AND i.status = 'pending'
     ORDER BY i.created_at ASC`,
    [householdId],
  )
  return rows
}

export async function findPendingInvite(
  inviteId: string,
  db: Queryable = getPool(),
): Promise<InviteSummary | undefined> {
  const { rows } = await db.query<InviteSummary>(
    `SELECT ${INVITE_COLUMNS}
     FROM household_invites i
     JOIN households h ON h.id = i.household_id
     WHERE i.id = $1`,
    [inviteId],
  )
  return rows[0]
}

/** Returns true if created, false if a pending invite for this household/email already exists. */
export async function createInvite(
  householdId: string,
  email: string,
  invitedBy: string,
  db: Queryable = getPool(),
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO household_invites (id, household_id, email, invited_by, status, created_at, resolved_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, NULL)
     ON CONFLICT (household_id, email) WHERE status = 'pending' DO NOTHING`,
    [crypto.randomUUID(), householdId, email, invitedBy, nowIso()],
  )
  return (result.rowCount ?? 0) > 0
}

/** Returns false if the invite was no longer pending (e.g. resolved concurrently). */
export async function resolveInvite(
  inviteId: string,
  status: Exclude<InviteStatus, 'pending'>,
  db: Queryable = getPool(),
): Promise<boolean> {
  const result = await db.query(
    `UPDATE household_invites SET status = $1, resolved_at = $2 WHERE id = $3 AND status = 'pending'`,
    [status, nowIso(), inviteId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function listInvitesForEmail(
  email: string,
  db: Queryable = getPool(),
): Promise<InviteSummary[]> {
  const { rows } = await db.query<InviteSummary>(
    `SELECT ${INVITE_COLUMNS}
     FROM household_invites i
     JOIN households h ON h.id = i.household_id
     WHERE i.email = $1 AND i.status = 'pending'
     ORDER BY i.created_at ASC`,
    [email],
  )
  return rows
}

export async function joinHousehold(
  householdId: string,
  userSub: string,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `INSERT INTO household_members (household_id, user_sub, role, joined_at)
     VALUES ($1, $2, 'member', $3)
     ON CONFLICT (household_id, user_sub) DO NOTHING`,
    [householdId, userSub, nowIso()],
  )
}

/**
 * Moves the caller's rows from one household into another, de-duplicating products
 * by lowercased name so joining two households doesn't create duplicate products.
 */
export async function migrateHouseholdData(
  fromHouseholdId: string,
  toHouseholdId: string,
  db?: Queryable,
): Promise<void> {
  await inTransaction(db, async (tx) => {
    const { rows: sourceProducts } = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM products WHERE household_id = $1 AND deleted_at IS NULL`,
      [fromHouseholdId],
    )
    const { rows: destProducts } = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM products WHERE household_id = $1 AND deleted_at IS NULL`,
      [toHouseholdId],
    )

    const destByLowerName = new Map(destProducts.map((p) => [p.name.toLowerCase(), p.id]))
    const productIdRemap = new Map<string, string>()

    for (const product of sourceProducts) {
      const existingId = destByLowerName.get(product.name.toLowerCase())
      if (existingId) {
        productIdRemap.set(product.id, existingId)
      }
    }

    for (const [oldId] of productIdRemap) {
      await tx.query(`DELETE FROM products WHERE id = $1 AND household_id = $2`, [
        oldId,
        fromHouseholdId,
      ])
    }

    await tx.query(`UPDATE products SET household_id = $1 WHERE household_id = $2`, [
      toHouseholdId,
      fromHouseholdId,
    ])

    for (const table of ['favourites', 'shopping_list', 'stock'] as const) {
      await tx.query(`UPDATE ${table} SET household_id = $1 WHERE household_id = $2`, [
        toHouseholdId,
        fromHouseholdId,
      ])

      for (const [oldProductId, newProductId] of productIdRemap) {
        await tx.query(
          `UPDATE ${table} SET product_id = $1 WHERE product_id = $2 AND household_id = $3`,
          [newProductId, oldProductId, toHouseholdId],
        )
      }
    }
  })
}
