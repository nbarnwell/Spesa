import { Router } from 'express'
import { getPool, nowIso } from '../db/index.js'
import { pullSync, pushSync, receiveDelivery, softDelete } from '../services/sync.js'
import { listHouseholdsForUser } from '../services/households.js'
import type { SyncPushRequest } from '../types.js'

export const apiRouter = Router()

apiRouter.get('/me', async (req, res) => {
  res.json({
    ...req.user,
    households: await listHouseholdsForUser(req.user!.sub),
    activeHouseholdId: req.householdId,
  })
})

apiRouter.get('/sync', async (req, res) => {
  const since = typeof req.query.since === 'string' ? req.query.since : undefined
  res.json(await pullSync(req.householdId!, since))
})

apiRouter.post('/sync', async (req, res) => {
  const body = req.body as SyncPushRequest
  const items = [
    ...(body.products ?? []),
    ...(body.favourites ?? []),
    ...(body.shoppingList ?? []),
    ...(body.stock ?? []),
  ]
  // Timestamps are stored as timestamptz, so an unparseable one would otherwise abort the
  // whole push as a 500.
  if (items.some((item) => Number.isNaN(Date.parse(item.updatedAt)))) {
    res.status(400).json({ error: 'Invalid updatedAt' })
    return
  }
  res.json(await pushSync(req.householdId!, body))
})

apiRouter.get('/products', async (req, res) => {
  const { rows } = await getPool().query<{
    id: string
    name: string
    category: string | null
    updatedAt: string
  }>(
    `SELECT id, name, category, updated_at AS "updatedAt"
     FROM products WHERE household_id = $1 AND deleted_at IS NULL ORDER BY name`,
    [req.householdId!],
  )

  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category ?? undefined,
      updatedAt: r.updatedAt,
    })),
  )
})

apiRouter.post('/products', async (req, res) => {
  const { name, category } = req.body as { name?: string; category?: string }
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const id = crypto.randomUUID()
  const updatedAt = nowIso()
  await getPool().query(
    `INSERT INTO products (id, household_id, name, category, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, NULL)`,
    [id, req.householdId!, name.trim(), category ?? null, updatedAt],
  )

  res.status(201).json({ id, name: name.trim(), category, updatedAt })
})

apiRouter.get('/favourites', async (req, res) => {
  const { rows } = await getPool().query(
    `SELECT f.id, f.product_id AS "productId", f.sort_order AS "sortOrder", f.updated_at AS "updatedAt",
            p.id AS "pId", p.name, p.category
     FROM favourites f
     JOIN products p ON p.id = f.product_id AND p.household_id = f.household_id
     WHERE f.household_id = $1 AND f.deleted_at IS NULL AND p.deleted_at IS NULL
     ORDER BY f.sort_order`,
    [req.householdId!],
  )

  res.json(rows)
})

apiRouter.post('/favourites', async (req, res) => {
  const { productId } = req.body as { productId?: string }
  if (!productId) {
    res.status(400).json({ error: 'productId is required' })
    return
  }

  const id = crypto.randomUUID()
  const updatedAt = nowIso()
  const { rows } = await getPool().query<{ sortOrder: number }>(
    `INSERT INTO favourites (id, household_id, product_id, sort_order, updated_at, deleted_at)
     SELECT $1::text, $2::text, $3::text, COALESCE(MAX(sort_order), -1) + 1, $4::timestamptz, NULL::timestamptz
     FROM favourites WHERE household_id = $2::text AND deleted_at IS NULL
     RETURNING sort_order AS "sortOrder"`,
    [id, req.householdId!, productId, updatedAt],
  )

  res.status(201).json({ id, productId, sortOrder: rows[0].sortOrder, updatedAt })
})

apiRouter.delete('/favourites/:id', async (req, res) => {
  const ok = await softDelete('favourites', req.householdId!, req.params.id)
  res.status(ok ? 204 : 404).end()
})

apiRouter.get('/shopping-list', async (req, res) => {
  const { rows } = await getPool().query<{
    id: string
    productId: string
    quantity: string | null
    checked: boolean
    updatedAt: string
  }>(
    `SELECT id, product_id AS "productId", quantity, checked, updated_at AS "updatedAt"
     FROM shopping_list WHERE household_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC`,
    [req.householdId!],
  )

  res.json(
    rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      quantity: r.quantity ?? undefined,
      checked: r.checked,
      updatedAt: r.updatedAt,
    })),
  )
})

apiRouter.post('/shopping-list', async (req, res) => {
  const { productId, quantity } = req.body as { productId?: string; quantity?: string }
  if (!productId) {
    res.status(400).json({ error: 'productId is required' })
    return
  }

  const id = crypto.randomUUID()
  const updatedAt = nowIso()
  await getPool().query(
    `INSERT INTO shopping_list (id, household_id, product_id, quantity, checked, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, FALSE, $5, NULL)`,
    [id, req.householdId!, productId, quantity ?? null, updatedAt],
  )

  res.status(201).json({ id, productId, quantity, checked: false, updatedAt })
})

apiRouter.patch('/shopping-list/:id', async (req, res) => {
  const { checked, quantity } = req.body as { checked?: boolean; quantity?: string }
  const updatedAt = nowIso()

  const { rows } = await getPool().query<{
    id: string
    productId: string
    quantity: string | null
    checked: boolean
  }>(
    `UPDATE shopping_list
     SET checked = COALESCE($1::boolean, checked),
         quantity = CASE WHEN $2::boolean THEN $3::text ELSE quantity END,
         updated_at = $4
     WHERE id = $5 AND household_id = $6 AND deleted_at IS NULL
     RETURNING id, product_id AS "productId", quantity, checked`,
    [
      checked === undefined ? null : Boolean(checked),
      quantity !== undefined,
      quantity ?? null,
      updatedAt,
      req.params.id,
      req.householdId!,
    ],
  )

  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json({
    id: row.id,
    productId: row.productId,
    quantity: row.quantity ?? undefined,
    checked: row.checked,
    updatedAt,
  })
})

apiRouter.delete('/shopping-list/:id', async (req, res) => {
  const ok = await softDelete('shopping_list', req.householdId!, req.params.id)
  res.status(ok ? 204 : 404).end()
})

apiRouter.post('/shopping-list/receive-delivery', async (req, res) => {
  const { onlyChecked = false } = req.body as { onlyChecked?: boolean }
  const moved = await receiveDelivery(req.householdId!, Boolean(onlyChecked))
  res.json({ moved })
})

apiRouter.get('/stock', async (req, res) => {
  const { rows } = await getPool().query<{
    id: string
    productId: string
    quantity: string | null
    status: 'in_stock' | 'depleted'
    updatedAt: string
  }>(
    `SELECT id, product_id AS "productId", quantity, status, updated_at AS "updatedAt"
     FROM stock WHERE household_id = $1 AND deleted_at IS NULL AND status = 'in_stock'
     ORDER BY updated_at DESC`,
    [req.householdId!],
  )

  res.json(
    rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      quantity: r.quantity ?? undefined,
      status: r.status,
      updatedAt: r.updatedAt,
    })),
  )
})

apiRouter.post('/stock', async (req, res) => {
  const { productId, quantity } = req.body as { productId?: string; quantity?: string }
  if (!productId) {
    res.status(400).json({ error: 'productId is required' })
    return
  }

  const id = crypto.randomUUID()
  const updatedAt = nowIso()
  await getPool().query(
    `INSERT INTO stock (id, household_id, product_id, quantity, status, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, 'in_stock', $5, NULL)`,
    [id, req.householdId!, productId, quantity ?? null, updatedAt],
  )

  res.status(201).json({ id, productId, quantity, status: 'in_stock', updatedAt })
})

apiRouter.patch('/stock/:id', async (req, res) => {
  const { status, quantity } = req.body as { status?: 'in_stock' | 'depleted'; quantity?: string }
  const updatedAt = nowIso()

  const { rows } = await getPool().query<{
    id: string
    productId: string
    quantity: string | null
    status: 'in_stock' | 'depleted'
  }>(
    `UPDATE stock
     SET status = COALESCE($1::text, status),
         quantity = CASE WHEN $2::boolean THEN $3::text ELSE quantity END,
         updated_at = $4
     WHERE id = $5 AND household_id = $6 AND deleted_at IS NULL
     RETURNING id, product_id AS "productId", quantity, status`,
    [
      status ?? null,
      quantity !== undefined,
      quantity ?? null,
      updatedAt,
      req.params.id,
      req.householdId!,
    ],
  )

  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json({
    id: row.id,
    productId: row.productId,
    quantity: row.quantity ?? undefined,
    status: row.status,
    updatedAt,
  })
})

apiRouter.delete('/stock/:id', async (req, res) => {
  const ok = await softDelete('stock', req.householdId!, req.params.id)
  res.status(ok ? 204 : 404).end()
})
