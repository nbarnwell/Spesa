import { getPool, nowIso, withTransaction, type Queryable } from '../db/index.js'
import type {
  FavouriteDto,
  ProductDto,
  ShoppingListItemDto,
  StockItemDto,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '../types.js'

function sinceFilter(since: string | undefined): string {
  return since ?? '1970-01-01T00:00:00.000Z'
}

export async function pullSync(householdId: string, since?: string): Promise<SyncPullResponse> {
  const cutoff = sinceFilter(since)
  const serverTime = nowIso()

  // One snapshot across all eight reads so a concurrent push can't be seen half-applied.
  const snapshot = await withTransaction(
    async (tx) => {
      const products = await tx.query<ProductDto & { deletedAt: string | null }>(
        `SELECT id, name, category, updated_at AS "updatedAt", deleted_at AS "deletedAt"
         FROM products
         WHERE household_id = $1 AND updated_at > $2 AND deleted_at IS NULL`,
        [householdId, cutoff],
      )
      const favourites = await tx.query<FavouriteDto & { deletedAt: string | null }>(
        `SELECT id, product_id AS "productId", sort_order AS "sortOrder", updated_at AS "updatedAt", deleted_at AS "deletedAt"
         FROM favourites
         WHERE household_id = $1 AND updated_at > $2 AND deleted_at IS NULL`,
        [householdId, cutoff],
      )
      const shoppingList = await tx.query<{
        id: string
        productId: string
        quantity: string | null
        checked: boolean
        updatedAt: string
        deletedAt: string | null
      }>(
        `SELECT id, product_id AS "productId", quantity, checked, updated_at AS "updatedAt", deleted_at AS "deletedAt"
         FROM shopping_list
         WHERE household_id = $1 AND updated_at > $2 AND deleted_at IS NULL`,
        [householdId, cutoff],
      )
      const stock = await tx.query<StockItemDto & { deletedAt: string | null }>(
        `SELECT id, product_id AS "productId", quantity, status, updated_at AS "updatedAt", deleted_at AS "deletedAt"
         FROM stock
         WHERE household_id = $1 AND updated_at > $2 AND deleted_at IS NULL`,
        [householdId, cutoff],
      )

      const deletedIds = async (table: string): Promise<string[]> => {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT id FROM ${table} WHERE household_id = $1 AND deleted_at IS NOT NULL AND deleted_at > $2`,
          [householdId, cutoff],
        )
        return rows.map((r) => r.id)
      }

      return {
        products: products.rows,
        favourites: favourites.rows,
        shoppingList: shoppingList.rows,
        stock: stock.rows,
        deleted: {
          products: await deletedIds('products'),
          favourites: await deletedIds('favourites'),
          shoppingList: await deletedIds('shopping_list'),
          stock: await deletedIds('stock'),
        },
      }
    },
    { isolation: 'repeatable read', readOnly: true },
  )

  return {
    serverTime,
    products: snapshot.products.map(({ category, ...rest }) => ({
      ...rest,
      category: category ?? undefined,
    })),
    favourites: snapshot.favourites,
    shoppingList: snapshot.shoppingList.map((row) => ({
      id: row.id,
      productId: row.productId,
      quantity: row.quantity ?? undefined,
      checked: row.checked,
      updatedAt: row.updatedAt,
    })),
    stock: snapshot.stock.map((row) => ({
      id: row.id,
      productId: row.productId,
      quantity: row.quantity ?? undefined,
      status: row.status,
      updatedAt: row.updatedAt,
    })),
    deleted: snapshot.deleted,
  }
}

// Each merge is one atomic conditional upsert: a strictly newer updatedAt wins, an equal or
// older one is a conflict, and a newer push un-deletes a tombstoned row. Doing the comparison
// in the statement (not a prior SELECT) keeps last-write-wins correct under concurrent pushes.

async function mergeProduct(db: Queryable, householdId: string, dto: ProductDto): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO products (id, household_id, name, category, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, NULL)
     ON CONFLICT (id, household_id) DO UPDATE SET
       name = EXCLUDED.name,
       category = EXCLUDED.category,
       updated_at = EXCLUDED.updated_at,
       deleted_at = NULL
     WHERE EXCLUDED.updated_at > products.updated_at
     RETURNING id`,
    [dto.id, householdId, dto.name, dto.category ?? null, dto.updatedAt],
  )
  return (result.rowCount ?? 0) > 0
}

async function mergeFavourite(
  db: Queryable,
  householdId: string,
  dto: FavouriteDto,
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO favourites (id, household_id, product_id, sort_order, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, NULL)
     ON CONFLICT (id, household_id) DO UPDATE SET
       product_id = EXCLUDED.product_id,
       sort_order = EXCLUDED.sort_order,
       updated_at = EXCLUDED.updated_at,
       deleted_at = NULL
     WHERE EXCLUDED.updated_at > favourites.updated_at
     RETURNING id`,
    [dto.id, householdId, dto.productId, dto.sortOrder, dto.updatedAt],
  )
  return (result.rowCount ?? 0) > 0
}

async function mergeShopping(
  db: Queryable,
  householdId: string,
  dto: ShoppingListItemDto,
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO shopping_list (id, household_id, product_id, quantity, checked, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)
     ON CONFLICT (id, household_id) DO UPDATE SET
       product_id = EXCLUDED.product_id,
       quantity = EXCLUDED.quantity,
       checked = EXCLUDED.checked,
       updated_at = EXCLUDED.updated_at,
       deleted_at = NULL
     WHERE EXCLUDED.updated_at > shopping_list.updated_at
     RETURNING id`,
    [dto.id, householdId, dto.productId, dto.quantity ?? null, dto.checked, dto.updatedAt],
  )
  return (result.rowCount ?? 0) > 0
}

async function mergeStock(db: Queryable, householdId: string, dto: StockItemDto): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO stock (id, household_id, product_id, quantity, status, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)
     ON CONFLICT (id, household_id) DO UPDATE SET
       product_id = EXCLUDED.product_id,
       quantity = EXCLUDED.quantity,
       status = EXCLUDED.status,
       updated_at = EXCLUDED.updated_at,
       deleted_at = NULL
     WHERE EXCLUDED.updated_at > stock.updated_at
     RETURNING id`,
    [dto.id, householdId, dto.productId, dto.quantity ?? null, dto.status, dto.updatedAt],
  )
  return (result.rowCount ?? 0) > 0
}

/** Consistent lock order across concurrent pushes touching overlapping rows. */
function sortedById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export async function pushSync(
  householdId: string,
  body: SyncPushRequest,
): Promise<SyncPushResponse> {
  const conflicts: SyncPushResponse['conflicts'] = []

  await withTransaction(async (tx) => {
    for (const product of sortedById(body.products)) {
      if (!(await mergeProduct(tx, householdId, product))) {
        const { rows } = await tx.query(
          `SELECT id, name, category, updated_at AS "updatedAt" FROM products WHERE id = $1 AND household_id = $2`,
          [product.id, householdId],
        )
        conflicts.push({ entity: 'product', id: product.id, serverVersion: rows[0] })
      }
    }
    for (const favourite of sortedById(body.favourites)) {
      if (!(await mergeFavourite(tx, householdId, favourite))) {
        const { rows } = await tx.query(
          `SELECT id, product_id AS "productId", sort_order AS "sortOrder", updated_at AS "updatedAt"
           FROM favourites WHERE id = $1 AND household_id = $2`,
          [favourite.id, householdId],
        )
        conflicts.push({ entity: 'favourite', id: favourite.id, serverVersion: rows[0] })
      }
    }
    for (const item of sortedById(body.shoppingList)) {
      if (!(await mergeShopping(tx, householdId, item))) {
        const { rows } = await tx.query(
          `SELECT id, product_id AS "productId", quantity, checked, updated_at AS "updatedAt"
           FROM shopping_list WHERE id = $1 AND household_id = $2`,
          [item.id, householdId],
        )
        conflicts.push({ entity: 'shoppingList', id: item.id, serverVersion: rows[0] })
      }
    }
    for (const item of sortedById(body.stock)) {
      if (!(await mergeStock(tx, householdId, item))) {
        const { rows } = await tx.query(
          `SELECT id, product_id AS "productId", quantity, status, updated_at AS "updatedAt"
           FROM stock WHERE id = $1 AND household_id = $2`,
          [item.id, householdId],
        )
        conflicts.push({ entity: 'stock', id: item.id, serverVersion: rows[0] })
      }
    }
  })

  return { serverTime: nowIso(), conflicts }
}

export async function softDelete(
  table: 'products' | 'favourites' | 'shopping_list' | 'stock',
  householdId: string,
  id: string,
  db: Queryable = getPool(),
): Promise<boolean> {
  const result = await db.query(
    `UPDATE ${table}
     SET deleted_at = $3, updated_at = $3
     WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL`,
    [id, householdId, nowIso()],
  )
  return (result.rowCount ?? 0) > 0
}

export async function receiveDelivery(householdId: string, onlyChecked: boolean): Promise<number> {
  const ts = nowIso()

  return withTransaction(async (tx) => {
    // Locking the list rows makes a concurrent delivery wait, then skip rows this one
    // tombstoned, so nothing is moved into stock twice.
    const { rows: items } = await tx.query<{
      id: string
      productId: string
      quantity: string | null
    }>(
      `SELECT id, product_id AS "productId", quantity
       FROM shopping_list
       WHERE household_id = $1 AND deleted_at IS NULL ${onlyChecked ? 'AND checked' : ''}
       ORDER BY id
       FOR UPDATE`,
      [householdId],
    )

    for (const item of items) {
      const { rows: existing } = await tx.query<{ id: string }>(
        `SELECT id FROM stock
         WHERE household_id = $1 AND product_id = $2 AND status = 'in_stock' AND deleted_at IS NULL`,
        [householdId, item.productId],
      )

      if (existing[0]) {
        await tx.query(
          `UPDATE stock SET quantity = $1, updated_at = $2 WHERE id = $3 AND household_id = $4`,
          [item.quantity, ts, existing[0].id, householdId],
        )
      } else {
        await tx.query(
          `INSERT INTO stock (id, household_id, product_id, quantity, status, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, 'in_stock', $5, NULL)`,
          [crypto.randomUUID(), householdId, item.productId, item.quantity, ts],
        )
      }

      await tx.query(
        `UPDATE shopping_list SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND household_id = $3`,
        [ts, item.id, householdId],
      )
    }

    return items.length
  })
}
