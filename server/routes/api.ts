import { Router } from 'express'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth } from '../auth/middleware.js'
import { pullSync, pushSync, receiveDelivery, softDelete } from '../services/sync.js'
import type { SyncPushRequest } from '../types.js'

export const apiRouter = Router()

apiRouter.use(requireAuth)

apiRouter.get('/me', (req, res) => {
  res.json(req.user)
})

apiRouter.get('/sync', (req, res) => {
  const since = typeof req.query.since === 'string' ? req.query.since : undefined
  res.json(pullSync(req.user!.sub, since))
})

apiRouter.post('/sync', (req, res) => {
  const body = req.body as SyncPushRequest
  res.json(pushSync(req.user!.sub, body))
})

apiRouter.get('/products', (req, res) => {
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT id, name, category, updated_at AS updatedAt
       FROM products WHERE user_sub = ? AND deleted_at IS NULL ORDER BY name`,
    )
    .all(req.user!.sub) as Array<{ id: string; name: string; category: string | null; updatedAt: string }>

  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category ?? undefined,
      updatedAt: r.updatedAt,
    })),
  )
})

apiRouter.post('/products', (req, res) => {
  const { name, category } = req.body as { name?: string; category?: string }
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const id = crypto.randomUUID()
  const updatedAt = nowIso()
  const database = getDb()
  database
    .prepare(
      `INSERT INTO products (id, user_sub, name, category, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(id, req.user!.sub, name.trim(), category ?? null, updatedAt)

  res.status(201).json({ id, name: name.trim(), category, updatedAt })
})

apiRouter.get('/favourites', (req, res) => {
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT f.id, f.product_id AS productId, f.sort_order AS sortOrder, f.updated_at AS updatedAt,
              p.id AS pId, p.name, p.category
       FROM favourites f
       JOIN products p ON p.id = f.product_id AND p.user_sub = f.user_sub
       WHERE f.user_sub = ? AND f.deleted_at IS NULL AND p.deleted_at IS NULL
       ORDER BY f.sort_order`,
    )
    .all(req.user!.sub)

  res.json(rows)
})

apiRouter.post('/favourites', (req, res) => {
  const { productId } = req.body as { productId?: string }
  if (!productId) {
    res.status(400).json({ error: 'productId is required' })
    return
  }

  const database = getDb()
  const max = database
    .prepare(`SELECT MAX(sort_order) AS m FROM favourites WHERE user_sub = ? AND deleted_at IS NULL`)
    .get(req.user!.sub) as { m: number | null }

  const id = crypto.randomUUID()
  const updatedAt = nowIso()
  database
    .prepare(
      `INSERT INTO favourites (id, user_sub, product_id, sort_order, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(id, req.user!.sub, productId, (max.m ?? -1) + 1, updatedAt)

  res.status(201).json({ id, productId, sortOrder: (max.m ?? -1) + 1, updatedAt })
})

apiRouter.delete('/favourites/:id', (req, res) => {
  const ok = softDelete('favourites', req.user!.sub, req.params.id)
  res.status(ok ? 204 : 404).end()
})

apiRouter.get('/shopping-list', (req, res) => {
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT id, product_id AS productId, quantity, checked, updated_at AS updatedAt
       FROM shopping_list WHERE user_sub = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
    )
    .all(req.user!.sub) as Array<{
    id: string
    productId: string
    quantity: string | null
    checked: number
    updatedAt: string
  }>

  res.json(
    rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      quantity: r.quantity ?? undefined,
      checked: Boolean(r.checked),
      updatedAt: r.updatedAt,
    })),
  )
})

apiRouter.post('/shopping-list', (req, res) => {
  const { productId, quantity } = req.body as { productId?: string; quantity?: string }
  if (!productId) {
    res.status(400).json({ error: 'productId is required' })
    return
  }

  const id = crypto.randomUUID()
  const updatedAt = nowIso()
  const database = getDb()
  database
    .prepare(
      `INSERT INTO shopping_list (id, user_sub, product_id, quantity, checked, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 0, ?, NULL)`,
    )
    .run(id, req.user!.sub, productId, quantity ?? null, updatedAt)

  res.status(201).json({ id, productId, quantity, checked: false, updatedAt })
})

apiRouter.patch('/shopping-list/:id', (req, res) => {
  const { checked, quantity } = req.body as { checked?: boolean; quantity?: string }
  const database = getDb()
  const existing = database
    .prepare(
      `SELECT id, product_id AS productId, quantity, checked, updated_at AS updatedAt
       FROM shopping_list WHERE id = ? AND user_sub = ? AND deleted_at IS NULL`,
    )
    .get(req.params.id, req.user!.sub) as {
    id: string
    productId: string
    quantity: string | null
    checked: number
    updatedAt: string
  } | undefined

  if (!existing) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const updatedAt = nowIso()
  const nextChecked = checked !== undefined ? (checked ? 1 : 0) : existing.checked
  const nextQty = quantity !== undefined ? quantity : existing.quantity

  database
    .prepare(
      `UPDATE shopping_list SET checked = ?, quantity = ?, updated_at = ? WHERE id = ? AND user_sub = ?`,
    )
    .run(nextChecked, nextQty, updatedAt, req.params.id, req.user!.sub)

  res.json({
    id: existing.id,
    productId: existing.productId,
    quantity: nextQty ?? undefined,
    checked: Boolean(nextChecked),
    updatedAt,
  })
})

apiRouter.delete('/shopping-list/:id', (req, res) => {
  const ok = softDelete('shopping_list', req.user!.sub, req.params.id)
  res.status(ok ? 204 : 404).end()
})

apiRouter.post('/shopping-list/receive-delivery', (req, res) => {
  const { onlyChecked = false } = req.body as { onlyChecked?: boolean }
  const moved = receiveDelivery(req.user!.sub, Boolean(onlyChecked))
  res.json({ moved })
})

apiRouter.get('/stock', (req, res) => {
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT id, product_id AS productId, quantity, status, updated_at AS updatedAt
       FROM stock WHERE user_sub = ? AND deleted_at IS NULL AND status = 'in_stock'
       ORDER BY updated_at DESC`,
    )
    .all(req.user!.sub) as Array<{
    id: string
    productId: string
    quantity: string | null
    status: 'in_stock' | 'depleted'
    updatedAt: string
  }>

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

apiRouter.post('/stock', (req, res) => {
  const { productId, quantity } = req.body as { productId?: string; quantity?: string }
  if (!productId) {
    res.status(400).json({ error: 'productId is required' })
    return
  }

  const id = crypto.randomUUID()
  const updatedAt = nowIso()
  const database = getDb()
  database
    .prepare(
      `INSERT INTO stock (id, user_sub, product_id, quantity, status, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 'in_stock', ?, NULL)`,
    )
    .run(id, req.user!.sub, productId, quantity ?? null, updatedAt)

  res.status(201).json({ id, productId, quantity, status: 'in_stock', updatedAt })
})

apiRouter.patch('/stock/:id', (req, res) => {
  const { status, quantity } = req.body as { status?: 'in_stock' | 'depleted'; quantity?: string }
  const database = getDb()
  const existing = database
    .prepare(
      `SELECT id, product_id AS productId, quantity, status, updated_at AS updatedAt
       FROM stock WHERE id = ? AND user_sub = ? AND deleted_at IS NULL`,
    )
    .get(req.params.id, req.user!.sub) as {
    id: string
    productId: string
    quantity: string | null
    status: 'in_stock' | 'depleted'
    updatedAt: string
  } | undefined

  if (!existing) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const updatedAt = nowIso()
  const nextStatus = status ?? existing.status
  const nextQty = quantity !== undefined ? quantity : existing.quantity

  database
    .prepare(`UPDATE stock SET status = ?, quantity = ?, updated_at = ? WHERE id = ? AND user_sub = ?`)
    .run(nextStatus, nextQty, updatedAt, req.params.id, req.user!.sub)

  res.json({
    id: existing.id,
    productId: existing.productId,
    quantity: nextQty ?? undefined,
    status: nextStatus,
    updatedAt,
  })
})

apiRouter.delete('/stock/:id', (req, res) => {
  const ok = softDelete('stock', req.user!.sub, req.params.id)
  res.status(ok ? 204 : 404).end()
})
